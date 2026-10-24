// Keyboard + phone inputs, combined by taking the larger magnitude of each.
import type { Controls } from './vehicle.ts';

export interface InputState extends Controls {
  /** Steering from the phone is absolute; from the keyboard it ramps. */
  steerAbsolute: boolean;
}

export function combine(kb: Controls, phone: Controls | null): InputState {
  if (!phone) return { ...kb, steerAbsolute: false };
  const pick = (a: number, b: number) => (Math.abs(a) >= Math.abs(b) ? a : b);
  const steerAbsolute = Math.abs(phone.steer) > Math.abs(kb.steer);
  return { steer: pick(kb.steer, phone.steer), throttle: Math.max(kb.throttle, phone.throttle), brake: Math.max(kb.brake, phone.brake), steerAbsolute };
}

export type KeyAction = 'indicator-left' | 'indicator-right' | 'handbrake' | 'recover' | 'reverse' | 'talk-start' | 'talk-end' | 'phone' | 'help' | 'debug' | 'exit';

export class Keyboard {
  down = new Set<string>();
  actions: KeyAction[] = [];
  private onDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (e.repeat) {
      this.down.add(k);
      return;
    }
    this.down.add(k);
    if (k === 'q') this.actions.push('indicator-left');
    if (k === 'e') this.actions.push('indicator-right');
    if (k === ' ') this.actions.push('handbrake');
    if (k === 'r') this.actions.push('recover');
    if (k === 'g') this.actions.push('reverse');
    if (k === 'v') this.actions.push('talk-start');
    if (k === 'p') this.actions.push('phone');
    if (k === 'h') this.actions.push('help');
    if (k === '`') this.actions.push('debug');
    if (k === 'escape') this.actions.push('exit');
  };
  private onUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    this.down.delete(k);
    if (k === 'v') this.actions.push('talk-end');
  };
  private onBlur = () => this.down.clear();

  attach() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }
  detach() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
  controls(): Controls {
    const d = this.down;
    const left = d.has('a') || d.has('arrowleft');
    const right = d.has('d') || d.has('arrowright');
    return {
      steer: left === right ? 0 : left ? -1 : 1,
      throttle: d.has('w') || d.has('arrowup') ? 1 : 0,
      brake: d.has('s') || d.has('arrowdown') ? 1 : 0,
    };
  }
  drain(): KeyAction[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }
}
