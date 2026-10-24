// Rule-based fault checks (always on, in the browser), mapped to DL25 marking-sheet categories.
import type { FaultRecord, Indicator } from '@lplate/shared';

export const DL25 = {
  kerb: 'Control – steering (Junctions – turning at junctions)',
  centreLine: 'Positioning – normal driving',
  signal: 'Signals – necessary',
  wrongSignal: 'Signals – correctly',
  speeding: 'Speed limits',
  redLight: 'Response to signals – traffic lights',
  collision: 'Awareness and planning',
} as const;

export interface FaultInput {
  time: number;
  speedMph: number;
  limitMph: number | null;
  road: string;
  indicator: Indicator;
  overCentre: boolean;
  throttle: number;
  handbrake: boolean;
}

export type TurnDirection = 'left' | 'right';

export class FaultChecker {
  faults: FaultRecord[] = [];
  newFaults: FaultRecord[] = [];
  hints: string[] = [];
  /** Last time each indicator was on (seconds). */
  private lastSignal: Record<'left' | 'right', number> = { left: -Infinity, right: -Infinity };
  private centreSince: number | null = null;
  private centreLogged = false;
  private overLimitSince: number | null = null;
  private lastSpeeding = -Infinity;
  private handbrakeThrottleSince: number | null = null;
  private hintShown = -Infinity;
  maxOverLimit = 0;

  private add(kind: keyof typeof DL25 | string, text: string, road: string, time: number) {
    const f: FaultRecord = { kind, category: DL25[kind as keyof typeof DL25] ?? kind, text, road, time };
    this.faults.push(f);
    this.newFaults.push(f);
  }

  update(s: FaultInput) {
    if (s.indicator === 'left' || s.indicator === 'right') this.lastSignal[s.indicator] = s.time;
    // Centre line: over it for more than 2.5 s.
    if (s.overCentre) {
      if (this.centreSince == null) this.centreSince = s.time;
      if (!this.centreLogged && s.time - this.centreSince > 2.5) {
        this.centreLogged = true;
        this.add('centreLine', 'Drove over the centre line', s.road, s.time);
      }
    } else {
      this.centreSince = null;
      this.centreLogged = false;
    }
    // Speeding: more than 3 mph over the posted limit (default 30) for 3 s, 30 s cooldown.
    const limit = s.limitMph ?? 30;
    const over = s.speedMph - limit;
    if (over > this.maxOverLimit) this.maxOverLimit = over;
    if (over > 3) {
      if (this.overLimitSince == null) this.overLimitSince = s.time;
      if (s.time - this.overLimitSince >= 3 && s.time - this.lastSpeeding >= 30) {
        this.lastSpeeding = s.time;
        this.add('speeding', `${Math.round(s.speedMph)} mph in a ${limit} mph limit`, s.road, s.time);
      }
    } else this.overLimitSince = null;
    // Hint: throttle with the handbrake on for 1.5 s.
    if (s.handbrake && s.throttle > 0.1) {
      if (this.handbrakeThrottleSince == null) this.handbrakeThrottleSince = s.time;
      if (s.time - this.handbrakeThrottleSince > 1.5 && s.time - this.hintShown > 8) {
        this.hintShown = s.time;
        this.hints.push('The handbrake is on: press Space to release it');
      }
    } else this.handbrakeThrottleSince = null;
  }

  /** A turn that needed a signal (sat nav turn, roundabout exit, end of road, or a ≥45° junction turn). */
  turn(dir: TurnDirection, time: number, road: string, what = 'turning') {
    const wrong = dir === 'left' ? 'right' : 'left';
    const okSignal = time - this.lastSignal[dir] <= 6;
    const wrongSignal = time - this.lastSignal[wrong] <= 6;
    if (okSignal) return;
    if (wrongSignal) this.add('wrongSignal', `Signalled ${wrong} before ${what} ${dir}`, road, time);
    else this.add('signal', `No signal before ${what} ${dir}`, road, time);
  }

  kerb(where: 'left' | 'right' | 'junction', time: number, road: string) {
    this.add('kerb', where === 'junction' ? 'Mounted the kerb at a junction' : `Mounted the kerb on the ${where}`, road, time);
  }

  redLight(time: number, road: string) {
    this.add('redLight', 'Went through a red light', road, time);
  }

  collision(what: string, time: number, road: string) {
    this.add('collision', what === 'car' ? 'Hit another vehicle' : what === 'tree' ? 'Hit a tree' : 'Hit a building', road, time);
  }

  drain(): { faults: FaultRecord[]; hints: string[] } {
    const out = { faults: this.newFaults, hints: this.hints };
    this.newFaults = [];
    this.hints = [];
    return out;
  }
}
