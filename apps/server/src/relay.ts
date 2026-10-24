// Pairing relay between the simulator ("host") and the phone ("controller").
import { randomBytes } from 'node:crypto';
import type { PairResponse, Role } from '@lplate/shared';

export interface Sock {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Peer {
  sock: Sock;
  lastSeen: number;
}

interface Session {
  hostToken: string;
  controllerToken: string;
  host?: Peer;
  controller?: Peer;
  created: number;
}

/** Message types each role may send; everything else is dropped. */
export const ALLOWED: Record<Role, Set<string>> = {
  controller: new Set(['controls', 'command', 'sensor', 'ping']),
  host: new Set(['state', 'fault', 'report', 'ping']),
};

const COMMANDS = new Set(['indicator-left', 'indicator-right', 'handbrake', 'recover', 'reverse']);
const SENSORS = new Set(['ok', 'flat', 'denied', 'unavailable']);

const SEVERITIES = new Set(['driving', 'serious', 'dangerous']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

const token = () => randomBytes(16).toString('base64url');
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Validate and normalise a message from a role; returns the JSON to relay, or null to drop. */
export function sanitize(role: Role, msg: any): Record<string, unknown> | null {
  if (!msg || typeof msg !== 'object' || !ALLOWED[role].has(msg.type)) return null;
  switch (msg.type) {
    case 'controls':
      if (!num(msg.steer, -1, 1) || !num(msg.throttle, 0, 1) || !num(msg.brake, 0, 1)) return null;
      return { type: 'controls', steer: msg.steer, throttle: msg.throttle, brake: msg.brake };
    case 'command':
      return COMMANDS.has(msg.command) ? { type: 'command', command: msg.command } : null;
    case 'sensor':
      return SENSORS.has(msg.status) ? { type: 'sensor', status: msg.status } : null;
    case 'state':
      return {
        type: 'state',
        indicator: ['off', 'left', 'right'].includes(msg.indicator) ? msg.indicator : 'off',
        indicatorLit: !!msg.indicatorLit,
        handbrake: !!msg.handbrake,
        speedMph: num(msg.speedMph, 0, 300) ? Math.round(msg.speedMph) : 0,
        driving: !!msg.driving,
        gear: msg.gear === 'R' ? 'R' : 'D',
      };
    case 'fault':
      return { type: 'fault', category: str(msg.category, 80), text: str(msg.text, 160), serious: !!msg.serious };
    case 'report':
      if (msg.result !== 'pass' && msg.result !== 'fail') return null;
      return {
        type: 'report',
        result: msg.result,
        summary: str(msg.summary, 600),
        faults: (Array.isArray(msg.faults) ? msg.faults : []).slice(0, 12).map((f: any) => ({
          category: str(f?.category, 80),
          severity: SEVERITIES.has(f?.severity) ? f.severity : 'driving',
          count: num(f?.count, 0, 99) ? Math.round(f.count) : 0,
        })),
        source: msg.source === 'nebius' ? 'nebius' : 'offline',
      };
    case 'ping':
      return { type: 'ping' };
  }
  return null;
}

export class Relay {
  sessions = new Map<string, Session>();
  now: () => number;
  silentMs: number;

  constructor(opts: { now?: () => number; silentMs?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.silentMs = opts.silentMs ?? 40_000;
  }

  pair(): PairResponse {
    const sessionId = randomBytes(6).toString('base64url');
    const s: Session = { hostToken: token(), controllerToken: token(), created: this.now() };
    this.sessions.set(sessionId, s);
    return { sessionId, hostToken: s.hostToken, controllerToken: s.controllerToken };
  }

  /** Attach a socket. Returns message/close handlers, or an error string. */
  attach(role: Role, sessionId: string, tok: string, sock: Sock): { onMessage(raw: string): void; onClose(): void } | string {
    const s = this.sessions.get(sessionId);
    if (!s) return 'unknown session';
    if ((role === 'host' ? s.hostToken : s.controllerToken) !== tok) return 'bad token';
    const old = s[role];
    if (old) {
      // One phone (and one simulator) per session: the newcomer replaces the old socket.
      old.sock.send(JSON.stringify({ type: 'replaced' }));
      old.sock.close(4000, 'replaced');
    }
    const me: Peer = { sock, lastSeen: this.now() };
    s[role] = me;
    const otherRole: Role = role === 'host' ? 'controller' : 'host';
    const other = s[otherRole];
    me.sock.send(JSON.stringify({ type: 'peer', connected: !!other }));
    if (other) other.sock.send(JSON.stringify({ type: 'peer', connected: true }));

    return {
      onMessage: (raw: string) => {
        me.lastSeen = this.now();
        let msg: unknown;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        const clean = sanitize(role, msg);
        if (!clean) return;
        if (clean.type === 'ping') {
          me.sock.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        s[otherRole]?.sock.send(JSON.stringify(clean));
      },
      onClose: () => {
        if (s[role] !== me) return; // already replaced
        s[role] = undefined;
        s[otherRole]?.sock.send(JSON.stringify({ type: 'peer', connected: false }));
      },
    };
  }

  /** Drop sockets that have been silent too long. Call every 15 s. */
  sweep(): number {
    let dropped = 0;
    const t = this.now();
    for (const s of this.sessions.values()) {
      for (const role of ['host', 'controller'] as Role[]) {
        const p = s[role];
        if (p && t - p.lastSeen > this.silentMs) {
          p.sock.close(4001, 'silent');
          s[role] = undefined;
          const other = s[role === 'host' ? 'controller' : 'host'];
          other?.sock.send(JSON.stringify({ type: 'peer', connected: false }));
          dropped++;
        }
      }
    }
    return dropped;
  }
}
