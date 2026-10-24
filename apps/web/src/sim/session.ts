// A driving session: builds the city from an extract, runs the fixed-step sim, routes events to
// faults, the coach and Sam, and publishes a HUD snapshot ~10×/s for useSyncExternalStore.
import type { ChatTurn, Debrief, DebriefRequest, DrivingStatus, FaultRecord, Indicator, TestRoute } from '@lplate/shared';
import { angleDiff, clamp, project } from './geo.ts';
import type { OsmExtract } from './osm.ts';
import { RoadNetwork } from './roads.ts';
import { AreaGrid, LandCover } from './raster.ts';
import { Signals } from './signals.ts';
import {
  bakeLightMap, infillHouses, layoutBuildings, placeParkedCars, placeStreetlights, placeTrees,
  type Lamp, type ParkedCar, type PlacedBuilding, type Tree,
} from './city.ts';
import { RoadWorld } from './world.ts';
import { Traffic, busyness } from './traffic.ts';
import { Navigator, fetchReroute, formatScreenDistance, formatSpokenDistance, type NavState } from './satnav.ts';
import { FaultChecker } from './faults.ts';
import { Coach } from './coach.ts';
import { Keyboard, combine } from './input.ts';
import type { Conditions } from './conditions.ts';
import type { HostLink } from '../net/pairing.ts';
import { Voice, PushToTalk, speechRecognitionSupported } from '../net/speech.ts';

export interface Toast {
  id: number;
  text: string;
  kind: 'fault' | 'warn' | 'info';
  until: number;
}

export interface HudSnapshot {
  speedMph: number;
  gear: 'D' | 'R';
  limit: number | null;
  road: string;
  indicator: Indicator;
  indicatorLit: boolean;
  handbrake: boolean;
  onPavement: boolean;
  toasts: Toast[];
  nav: (NavState & { instruction: string | null; distanceText: string; thenText: string | null; milesLeft: string }) | null;
  caption: string | null;
  listening: boolean;
  typing: boolean;
  faults: number;
  carsNearby: number;
  trafficSource: string;
  phoneConnected: boolean;
  instructor: 'on' | 'off' | 'unavailable';
  instructorNote: string | null;
  finished: boolean;
  debrief: Debrief | null;
  debriefLoading: boolean;
  faultLog: FaultRecord[];
  showHelp: boolean;
  showDebug: boolean;
  showPhone: boolean;
  exit: boolean;
  debug: Record<string, string | number>;
  version: number;
}

export interface SessionSetup {
  kind: 'route' | 'free';
  id: string;
  name: string;
  extract: OsmExtract;
  route?: TestRoute;
  start: { lat: number; lng: number; heading: number };
  conditions: Conditions;
  voice: boolean;
  instructor: boolean;
  instructorAvailable: boolean;
  host: HostLink | null;
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

export class Session {
  setup: SessionSetup;
  ex: OsmExtract;
  net!: RoadNetwork;
  grid!: AreaGrid;
  land!: LandCover;
  buildings: PlacedBuilding[] = [];
  infillCount = 0;
  signals!: Signals;
  parked: ParkedCar[] = [];
  trees: Tree[] = [];
  lamps: Lamp[] = [];
  lightMap!: { n: number; cell: number; data: Uint8Array };
  world!: RoadWorld;
  traffic!: Traffic;
  nav: Navigator | null = null;
  faults = new FaultChecker();
  coach = new Coach();
  keyboard = new Keyboard();
  voice: Voice;
  ptt = new PushToTalk();
  conditions: Conditions;
  paused = true;
  time = 0;
  indicator: Indicator = 'off';
  indicatorLit = false;
  private indicatorPhase = 0;
  private indicatorSince = 0;
  /** Camera spring (body bounce). */
  spring = { y: 0, v: 0 };
  rumble = 0;
  pitch = 0;
  private toasts: Toast[] = [];
  private toastId = 1;
  private turns: ChatTurn[] = [];
  private instructorBusy = false;
  private caption: string | null = null;
  private captionUntil = 0;
  private listening = false;
  private typing = false;
  private lastPublish = -Infinity;
  private lastPhoneState = -Infinity;
  private passedStep = -1;
  private lastCollisionFault = -Infinity;
  private lastStepCheck = -Infinity;
  private distance = 0;
  private finished = false;
  private debrief: Debrief | null = null;
  private debriefLoading = false;
  /** The fault log sent to the examiner, kept so the model referee can replay it. */
  debriefRequest: DebriefRequest | null = null;
  private showHelp = false;
  private showDebug = false;
  private showPhone = false;
  private exit = false;
  private instructorState: 'on' | 'off' | 'unavailable';
  private instructorNote: string | null = null;
  private sessionId = Math.random().toString(36).slice(2);
  private listeners = new Set<() => void>();
  snapshot: HudSnapshot;
  debugExtra: Record<string, string | number> = {};
  /** Map imagery credit (Google 3D Tiles), shown with the attribution. */
  mapCredit: string | null = null;

  constructor(setup: SessionSetup) {
    this.setup = setup;
    this.ex = setup.extract;
    this.conditions = setup.conditions;
    this.voice = new Voice(setup.voice);
    this.instructorState = !setup.instructor ? 'off' : setup.instructorAvailable ? 'on' : 'unavailable';
    if (this.instructorState === 'unavailable') this.instructorNote = 'Sam is unavailable: the server has no Nebius key or is down.';
    this.snapshot = this.makeSnapshot();
  }

  /** Build the city. Yields between heavy steps so the loading text can update. */
  async build(progress: (msg: string) => void) {
    const ex = this.ex;
    progress('Laying out roads…');
    await nextTick();
    this.net = new RoadNetwork(ex);
    const land0 = LandCover.build(ex);
    progress('Placing buildings…');
    await nextTick();
    this.buildings = layoutBuildings(ex);
    const infill = infillHouses(this.net, ex.buildings.map((b) => b.pts), land0);
    this.infillCount = infill.houses.length;
    this.buildings.push(...infill.houses);
    this.land = infill.gardens.length ? LandCover.build(ex, infill.gardens) : land0;
    progress('Painting the streets…');
    await nextTick();
    this.grid = AreaGrid.build(ex, this.net, infill.houses.map((h) => h.pts));
    this.signals = new Signals(ex.points, this.net);
    const [sx, sz] = project(ex.origin, this.setup.start.lat, this.setup.start.lng);
    const spawn = this.net.spawnNear(sx, sz, this.setup.start.heading) ?? { x: sx, z: sz, heading: this.setup.start.heading };
    progress('Parking cars and planting trees…');
    await nextTick();
    this.parked = placeParkedCars(this.net, this.signals, spawn);
    this.trees = placeTrees(ex, this.grid);
    this.lamps = placeStreetlights(this.net, this.grid);
    this.lightMap = bakeLightMap(this.lamps, ex.radius);
    this.world = new RoadWorld(this.net, this.grid, this.signals, ex.origin);
    for (const p of this.parked) this.world.addObstacle({ kind: 'car', x: p.x, z: p.z, hl: 2.1, hw: 0.9, heading: p.heading });
    for (const t of this.trees) this.world.addObstacle({ kind: 'tree', x: t.x, z: t.z, hl: 0.3, hw: 0.3, heading: 0 });
    this.world.place(spawn.x, spawn.z, spawn.heading);
    this.traffic = new Traffic(this.net, this.signals);
    if (this.setup.route) {
      this.nav = new Navigator(this.setup.route, ex.origin, fetchReroute);
    }
    this.keyboard.attach();
  }

  start() {
    this.paused = false;
    const r = this.setup.route;
    if (r) {
      const first = r.steps.find((s) => s.type !== 'depart') ?? r.steps[0];
      const dist = first ? formatSpokenDistance(first.at) : '';
      this.coach.push('lesson', `Lesson start: the "${r.name}" test route from ${r.centre.name}. The car is parked with the handbrake on. First instruction: ${first?.instruction ?? 'follow the road'} ${dist}. Greet the learner briefly and give that first instruction.`, this.time);
    } else {
      this.coach.push('lesson', `Free drive starting on ${this.setup.name}. The car is parked with the handbrake on. Greet the learner briefly, remind them to release the handbrake (Space) and drive on the left.`, this.time);
    }
    this.publish(true);
  }

  dispose() {
    this.keyboard.detach();
    this.voice.cancel();
    this.listeners.clear();
  }

  // ---------- store ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private toast(text: string, kind: Toast['kind'] = 'fault', secs = 3.5) {
    this.toasts = this.toasts.filter((t) => t.text !== text);
    this.toasts.push({ id: this.toastId++, text, kind, until: this.time + secs });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  private status(): DrivingStatus {
    const n = this.nav?.state;
    return {
      speedMph: Math.abs(this.world.car.speed) * 2.23694,
      limitMph: this.currentLimit(),
      road: this.world.under?.road ?? '',
      indicator: this.indicator,
      handbrake: this.world.car.handbrake,
      nextInstruction: n?.next?.instruction ?? null,
      distanceToNext: n?.next ? formatSpokenDistance(n.distance) : null,
      faultsSoFar: this.faults.faults.length,
    };
  }

  currentLimit(): number | null {
    return this.nav?.state.limit ?? this.world.under?.limit ?? null;
  }

  private makeSnapshot(): HudSnapshot {
    const w = this.world;
    const n = this.nav?.state;
    const nav = n
      ? {
          ...n,
          instruction: n.status === 'arrived' ? 'You have arrived' : n.next?.instruction ?? 'Follow the road',
          distanceText: formatScreenDistance(Math.max(0, n.distance)),
          thenText: n.then ? n.then.instruction : null,
          milesLeft: (n.remaining / 1609.344).toFixed(1),
        }
      : null;
    return {
      speedMph: w ? Math.round(Math.abs(w.car.speed) * 2.23694) : 0,
      gear: w?.car.reverse ? 'R' : 'D',
      limit: w ? this.currentLimit() : null,
      road: w?.under?.road ?? '',
      indicator: this.indicator,
      indicatorLit: this.indicatorLit,
      handbrake: w?.car.handbrake ?? true,
      onPavement: w?.onPavement ?? false,
      toasts: this.toasts.filter((t) => t.until > this.time),
      nav,
      caption: this.time < this.captionUntil ? this.caption : null,
      listening: this.listening,
      typing: this.typing,
      faults: this.faults.faults.length,
      carsNearby: this.traffic?.cars.length ?? 0,
      trafficSource: this.traffic?.liveSource === 'live' ? 'live, Google' : 'typical',
      phoneConnected: this.setup.host?.phoneConnected ?? false,
      instructor: this.instructorState,
      instructorNote: this.instructorNote,
      finished: this.finished,
      debrief: this.debrief,
      debriefLoading: this.debriefLoading,
      faultLog: this.faults.faults,
      showHelp: this.showHelp,
      showDebug: this.showDebug,
      showPhone: this.showPhone,
      exit: this.exit,
      debug: w
        ? {
            speed: `${(Math.abs(w.car.speed) * 2.23694).toFixed(1)} mph${w.car.reverse ? ' (R)' : ''}`,
            heading: w.car.heading.toFixed(1),
            lateral: w.under ? w.under.lateral.toFixed(2) : '–',
            road: w.under ? `${w.under.road || '(unnamed)'} · ${w.under.seg.road.highway} · ${w.under.limit} mph` : '–',
            controls: `steer ${w.car.steer.toFixed(2)}`,
            ...this.debugExtra,
          }
        : {},
      version: (this.snapshot?.version ?? 0) + 1,
    };
  }

  publish(force = false) {
    if (!force && this.time - this.lastPublish < 0.1) return;
    this.lastPublish = this.time;
    this.snapshot = this.makeSnapshot();
    for (const l of this.listeners) l();
  }

  toggle(what: 'help' | 'debug' | 'phone') {
    if (what === 'help') this.showHelp = !this.showHelp;
    if (what === 'debug') this.showDebug = !this.showDebug;
    if (what === 'phone') this.showPhone = !this.showPhone;
    this.publish(true);
  }

  // ---------- controls ----------
  private setIndicator(dir: 'left' | 'right') {
    this.indicator = this.indicator === dir ? 'off' : dir;
    this.indicatorSince = this.time;
    this.indicatorPhase = 0;
  }

  private command(c: string) {
    const car = this.world.car;
    if (c === 'indicator-left') this.setIndicator('left');
    else if (c === 'indicator-right') this.setIndicator('right');
    else if (c === 'handbrake') car.handbrake = !car.handbrake;
    else if (c === 'reverse') {
      if (car.toggleReverse()) this.toast(car.reverse ? 'Reverse gear (R)' : 'Drive (D)', 'info', 1.5);
      else this.toast('Stop the car before changing gear', 'warn', 2);
    }
    else if (c === 'recover') {
      this.world.recover();
      this.toast('Car recovered to the nearest lane', 'info', 2);
    }
  }

  // ---------- instructor ----------
  private async askInstructor(simLines: string[], interrupt: boolean) {
    if (this.instructorState !== 'on') return;
    this.instructorBusy = true;
    try {
      const res = await fetch('/api/instructor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, turns: this.turns.slice(-12), sim: simLines, status: this.status() }),
      });
      if (res.status === 429) return;
      const j = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        if (res.status === 401 || res.status === 402 || res.status === 503) {
          this.instructorState = 'unavailable';
          this.instructorNote = j.error ?? 'Sam is unavailable.';
        }
        return;
      }
      const text = (j.text ?? '').trim();
      if (!text) return;
      this.turns.push({ role: 'instructor', text });
      this.turns = this.turns.slice(-12);
      this.caption = text;
      this.captionUntil = this.time + Math.max(4, text.length / 12);
      this.publish(true);
      await this.voice.say(text, interrupt);
    } catch {
      /* network blip: Sam stays quiet */
    } finally {
      this.instructorBusy = false;
    }
  }

  async learnerSays(text: string) {
    const t = text.trim();
    if (!t) return;
    this.turns.push({ role: 'learner', text: t });
    this.caption = `You: ${t}`;
    this.captionUntil = this.time + 3;
    await this.askInstructor([], false);
  }

  private talkStart() {
    if (this.instructorState !== 'on') return;
    if (!speechRecognitionSupported()) {
      this.typing = true;
      this.publish(true);
      return;
    }
    // The mic stays closed while Sam talks, so he never hears himself.
    this.voice.cancel();
    this.listening = this.ptt.start();
    this.publish(true);
  }

  private async talkEnd() {
    if (!this.listening) return;
    this.listening = false;
    this.publish(true);
    const text = await this.ptt.stop();
    if (text) await this.learnerSays(text);
  }

  closeTyping() {
    this.typing = false;
    this.publish(true);
  }

  // ---------- lesson end ----------
  async finish() {
    if (this.finished) return;
    this.finished = true;
    this.paused = true;
    this.debriefLoading = true;
    this.voice.cancel();
    this.publish(true);
    const body = {
      route: this.setup.route ? `${this.setup.route.name} (${this.setup.route.centre.name})` : `a free drive on ${this.setup.name}`,
      faults: this.faults.faults,
      stats: { distance: this.distance, duration: this.time, maxSpeedOverLimit: Math.max(0, this.faults.maxOverLimit) },
    };
    this.debriefRequest = body;
    try {
      const res = await fetch('/api/debrief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      this.debrief = (await res.json()) as Debrief;
    } catch {
      this.debrief = offlineDebrief(this.faults.faults);
    }
    this.debriefLoading = false;
    this.publish(true);
    if (this.debrief) {
      const d = this.debrief;
      this.setup.host?.send({ type: 'report', result: d.result, summary: d.summary, faults: d.faults.map(({ category, severity, count }) => ({ category, severity, count })), source: d.source });
    }
    if (this.debrief && this.instructorState === 'on') {
      this.voice.say(`${this.debrief.result === 'pass' ? 'That would be a pass.' : "I'm afraid that would be a fail."} ${this.debrief.summary}`);
    }
  }

  // ---------- step ----------
  step(dt: number) {
    for (const a of this.keyboard.drain()) {
      if (a === 'help' || a === 'debug' || a === 'phone') this.toggle(a);
      else if (a === 'exit') {
        this.exit = true;
        this.publish(true);
      } else if (a === 'talk-start') this.talkStart();
      else if (a === 'talk-end') this.talkEnd();
      else if (!this.paused) this.command(a);
    }
    if (this.paused) {
      this.publish();
      return;
    }
    this.time += dt;
    const host = this.setup.host;
    if (host) {
      for (const c of host.commands.splice(0)) this.command(c);
    }
    const w = this.world;
    const car = w.car;
    const inp = combine(this.keyboard.controls(), host?.phoneControls() ?? null);
    car.updateSteer(inp.steer, inp.steerAbsolute, dt);
    const before = [car.x, car.z];
    w.step(inp, dt);
    this.distance += Math.hypot(car.x - before[0], car.z - before[1]);

    // Indicators blink at ~1.5 Hz.
    if (this.indicator !== 'off') {
      this.indicatorPhase += dt;
      this.indicatorLit = this.indicatorPhase % 0.8 < 0.4;
    } else this.indicatorLit = false;

    // Traffic.
    this.traffic.busy = busyness(this.conditions.hour, this.conditions.weekend);
    const [cx, cz] = car.centre();
    this.traffic.step(dt, { x: cx, z: cz, heading: car.heading, speed: Math.max(0, car.speed) });
    w.dynamicObstacles = this.traffic.obstacles();

    // Camera spring and motion.
    const k = 260;
    const c = 14;
    this.spring.v += (-k * this.spring.y - c * this.spring.v) * dt;
    this.spring.y += this.spring.v * dt;
    this.pitch += (clamp(-car.accel * 0.006, -0.03, 0.03) - this.pitch) * Math.min(1, dt * 4);
    this.rumble = car.speed;

    const road = w.under?.road ?? '';
    for (const e of w.drain()) {
      switch (e.type) {
        case 'bump':
          this.spring.v += 0.55 * e.strength;
          break;
        case 'collision':
          this.toast(e.what === 'car' ? 'You hit a parked car!' : e.what === 'tree' ? 'You hit a tree!' : 'You hit a building!');
          // Pressing against the same obstacle is one fault, not one per bump.
          if (this.time - this.lastCollisionFault > 6) this.faults.collision(e.what, this.time, road);
          this.lastCollisionFault = this.time;
          break;
        case 'kerb':
          this.toast('You mounted the kerb!');
          this.faults.kerb(e.where, this.time, road);
          break;
        case 'centreLine':
          if (e.over) this.toast('Over the centre line', 'warn', 2.5);
          break;
        case 'redLight':
          this.toast('You went through a red light');
          this.faults.redLight(this.time, road);
          break;
        case 'turn':
          if (Math.abs(e.angle) >= 45) {
            // Cancel the indicator after the turn, like a real stalk.
            if (this.indicator !== 'off' && this.time - this.indicatorSince > 1) this.indicator = 'off';
            if (!this.nav || this.time - this.lastStepCheck > 8) {
              this.faults.turn(e.angle < 0 ? 'left' : 'right', this.time, road);
            }
          }
          break;
      }
    }

    // Sat nav.
    if (this.nav) {
      const pos = w.position;
      this.nav.update(w.car.x, w.car.z, car.heading, car.speed, this.time, pos);
      for (const ev of this.nav.drain()) {
        if (ev.type === 'announce') {
          const then = ev.then ? `, then ${ev.then.instruction.charAt(0).toLowerCase()}${ev.then.instruction.slice(1)}` : '';
          this.coach.push('direction', `Direction: ${ev.spoken}, ${ev.step.instruction}${then}.`, this.time);
          if (this.instructorState !== 'on') this.voice.say(`${capitalise(ev.spoken)}, ${ev.step.instruction}${then}.`);
        } else if (ev.type === 'offRoute') {
          this.toast('Off route: recalculating', 'info', 2.5);
          this.coach.push('lesson', 'The learner has gone off the planned route. The sat nav is recalculating. Reassure them briefly.', this.time);
        } else if (ev.type === 'rerouted') {
          this.coach.push('lesson', 'The sat nav has found a new route back to the test centre.', this.time);
        } else if (ev.type === 'arrived') {
          this.coach.push('lesson', 'Arrived back at the test centre. Ask the learner to pull up on the left when safe.', this.time);
          setTimeout(() => this.finish(), 2500);
        }
      }
      // Signal checks as the car passes a turning step.
      const steps = this.nav.steps;
      const s = this.nav.tracker.s;
      if (!this.nav.tracker.off) {
        for (let i = this.passedStep + 1; i < steps.length && steps[i].at < s; i++) {
          this.passedStep = i;
          const st = steps[i];
          const m = st.modifier ?? '';
          const turning = ['turn', 'end of road', 'roundabout', 'rotary', 'roundabout turn', 'fork'].includes(st.type) || (st.type === 'continue' && /left|right/.test(m) && !m.startsWith('slight'));
          if (!turning || s - st.at > 60) continue;
          let dir: 'left' | 'right' | null = /left/.test(m) ? 'left' : /right/.test(m) ? 'right' : null;
          if (st.type === 'roundabout' || st.type === 'rotary') dir = 'left'; // signal left to leave a roundabout
          if (!dir || m === 'straight' || m.startsWith('slight')) continue;
          this.lastStepCheck = this.time;
          this.faults.turn(dir, this.time, st.road || road, st.type.includes('roundabout') || st.type === 'rotary' ? 'leaving the roundabout' : 'turning');
        }
      }
    }

    // Faults.
    const limit = this.currentLimit();
    this.faults.update({
      time: this.time,
      speedMph: Math.abs(car.speed) * 2.23694,
      limitMph: limit,
      road,
      indicator: this.indicator,
      overCentre: w.overCentre,
      throttle: inp.throttle,
      handbrake: car.handbrake,
    });
    const drained = this.faults.drain();
    for (const f of drained.faults) {
      this.setup.host?.send({ type: 'fault', category: f.category, text: f.text, serious: f.kind === 'collision' || f.kind === 'redLight' });
      if (f.kind === 'signal' || f.kind === 'wrongSignal' || f.kind === 'speeding' || f.kind === 'centreLine') this.toast(`${f.text} · ${f.category}`);
      this.coach.push('fault', `Fault (${f.category}): ${f.text}${f.road ? ` on ${f.road}` : ''}. Give one short, calm piece of feedback.`, this.time);
    }
    for (const h of drained.hints) {
      this.toast(h, 'info', 3);
      this.coach.push('hint', `Hint: ${h}.`, this.time);
    }

    // Coach → Sam.
    if (this.instructorState === 'on') {
      const n = this.coach.next(this.time, this.voice.idle && !this.instructorBusy);
      if (n) this.askInstructor([n.prompt.text], n.interrupt);
    } else {
      this.coach.queue.length = 0;
    }

    // Phone state ~10 Hz.
    if (host && this.time - this.lastPhoneState > 0.1) {
      this.lastPhoneState = this.time;
      host.sendState({ type: 'state', indicator: this.indicator, indicatorLit: this.indicatorLit, handbrake: car.handbrake, speedMph: Math.round(Math.abs(car.speed) * 2.23694), driving: true, gear: car.reverse ? 'R' : 'D' });
    }
    this.publish();
  }

  /** Heading change for tests and debug. */
  headingTo(h: number) {
    return angleDiff(h, this.world.car.heading);
  }
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function offlineDebrief(faults: FaultRecord[]): Debrief {
  const groups = new Map<string, number>();
  for (const f of faults) groups.set(f.category, (groups.get(f.category) ?? 0) + 1);
  const serious = faults.some((f) => f.kind === 'redLight' || f.kind === 'collision');
  const result = serious || faults.length > 15 ? 'fail' : 'pass';
  return {
    result,
    summary: `${faults.length} fault${faults.length === 1 ? '' : 's'} recorded. The examiner is offline, so this debrief is rule-based.`,
    faults: [...groups].map(([category, count]) => ({ category, severity: 'driving', count, advice: 'Practise this with your instructor.' })),
    focusNext: [...groups.keys()].slice(0, 3),
    source: 'offline',
  };
}
