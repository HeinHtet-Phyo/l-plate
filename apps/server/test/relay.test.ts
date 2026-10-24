import { describe, expect, it } from 'vitest';
import { Relay, sanitize, type Sock } from '../src/relay.ts';

class FakeSock implements Sock {
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

function connect(relay: Relay, role: 'host' | 'controller', sessionId: string, token: string) {
  const sock = new FakeSock();
  const h = relay.attach(role, sessionId, token, sock);
  if (typeof h === 'string') throw new Error(h);
  return { sock, h };
}

describe('sanitize', () => {
  it('keeps valid controls and strips extra fields', () => {
    expect(sanitize('controller', { type: 'controls', steer: -0.5, throttle: 1, brake: 0, evil: 'x' })).toEqual({
      type: 'controls',
      steer: -0.5,
      throttle: 1,
      brake: 0,
    });
  });

  it('drops out-of-range or non-numeric controls', () => {
    expect(sanitize('controller', { type: 'controls', steer: 2, throttle: 0, brake: 0 })).toBeNull();
    expect(sanitize('controller', { type: 'controls', steer: 0, throttle: -0.1, brake: 0 })).toBeNull();
    expect(sanitize('controller', { type: 'controls', steer: NaN, throttle: 0, brake: 0 })).toBeNull();
    expect(sanitize('controller', { type: 'controls', steer: '0', throttle: 0, brake: 0 })).toBeNull();
  });

  it('enforces which message types each role may send', () => {
    expect(sanitize('host', { type: 'controls', steer: 0, throttle: 0, brake: 0 })).toBeNull();
    expect(sanitize('controller', { type: 'state' })).toBeNull();
    expect(sanitize('controller', null)).toBeNull();
    expect(sanitize('controller', 'ping')).toBeNull();
  });

  it('only allows known commands and sensor states', () => {
    expect(sanitize('controller', { type: 'command', command: 'handbrake' })).toEqual({ type: 'command', command: 'handbrake' });
    expect(sanitize('controller', { type: 'command', command: 'reverse' })).toEqual({ type: 'command', command: 'reverse' });
    expect(sanitize('controller', { type: 'command', command: 'self-destruct' })).toBeNull();
    expect(sanitize('controller', { type: 'sensor', status: 'denied' })).toEqual({ type: 'sensor', status: 'denied' });
    expect(sanitize('controller', { type: 'sensor', status: 'weird' })).toBeNull();
  });

  it('normalises host state', () => {
    expect(sanitize('host', { type: 'state', indicator: 'up', indicatorLit: 1, handbrake: 0, speedMph: 29.6, driving: true })).toEqual({
      type: 'state',
      indicator: 'off',
      indicatorLit: true,
      handbrake: false,
      speedMph: 30,
      driving: true,
      gear: 'D',
    });
    expect(sanitize('host', { type: 'state', gear: 'R' })).toMatchObject({ gear: 'R' });
    expect(sanitize('host', { type: 'state', speedMph: 9999 })).toMatchObject({ speedMph: 0 });
  });
});

describe('Relay', () => {
  it('pairs with distinct tokens', () => {
    const r = new Relay();
    const p = r.pair();
    expect(p.sessionId).toBeTruthy();
    expect(p.hostToken).not.toBe(p.controllerToken);
    expect(r.sessions.has(p.sessionId)).toBe(true);
  });

  it('rejects unknown sessions and wrong tokens', () => {
    const r = new Relay();
    const p = r.pair();
    expect(r.attach('host', 'nope', p.hostToken, new FakeSock())).toBe('unknown session');
    expect(r.attach('host', p.sessionId, p.controllerToken, new FakeSock())).toBe('bad token');
    expect(r.attach('controller', p.sessionId, p.hostToken, new FakeSock())).toBe('bad token');
  });

  it('announces peers and relays sanitised messages both ways', () => {
    const r = new Relay();
    const p = r.pair();
    const host = connect(r, 'host', p.sessionId, p.hostToken);
    expect(host.sock.last()).toEqual({ type: 'peer', connected: false });
    const phone = connect(r, 'controller', p.sessionId, p.controllerToken);
    expect(phone.sock.last()).toEqual({ type: 'peer', connected: true });
    expect(host.sock.last()).toEqual({ type: 'peer', connected: true });

    phone.h.onMessage(JSON.stringify({ type: 'controls', steer: 0.1, throttle: 0.5, brake: 0, x: 1 }));
    expect(host.sock.last()).toEqual({ type: 'controls', steer: 0.1, throttle: 0.5, brake: 0 });

    host.h.onMessage(JSON.stringify({ type: 'state', indicator: 'left', indicatorLit: true, handbrake: false, speedMph: 12, driving: true }));
    expect(phone.sock.last()).toMatchObject({ type: 'state', indicator: 'left', speedMph: 12 });
  });

  it('drops garbage and answers pings without relaying', () => {
    const r = new Relay();
    const p = r.pair();
    const host = connect(r, 'host', p.sessionId, p.hostToken);
    const phone = connect(r, 'controller', p.sessionId, p.controllerToken);
    const before = host.sock.sent.length;
    phone.h.onMessage('{not json');
    phone.h.onMessage(JSON.stringify({ type: 'state' }));
    phone.h.onMessage(JSON.stringify({ type: 'ping' }));
    expect(host.sock.sent.length).toBe(before);
    expect(phone.sock.last()).toEqual({ type: 'pong' });
  });

  it('replaces an older socket for the same role', () => {
    const r = new Relay();
    const p = r.pair();
    const host = connect(r, 'host', p.sessionId, p.hostToken);
    const phone1 = connect(r, 'controller', p.sessionId, p.controllerToken);
    const phone2 = connect(r, 'controller', p.sessionId, p.controllerToken);
    expect(phone1.sock.sent).toContainEqual({ type: 'replaced' });
    expect(phone1.sock.closed?.code).toBe(4000);
    // The stale close must not announce a disconnect.
    const before = host.sock.sent.length;
    phone1.h.onClose();
    expect(host.sock.sent.length).toBe(before);
    phone2.h.onClose();
    expect(host.sock.last()).toEqual({ type: 'peer', connected: false });
  });

  it('sweeps silent sockets and tells the other side', () => {
    let t = 0;
    const r = new Relay({ now: () => t, silentMs: 1000 });
    const p = r.pair();
    const host = connect(r, 'host', p.sessionId, p.hostToken);
    const phone = connect(r, 'controller', p.sessionId, p.controllerToken);
    t = 900;
    host.h.onMessage(JSON.stringify({ type: 'ping' }));
    t = 1500;
    expect(r.sweep()).toBe(1);
    expect(phone.sock.closed?.code).toBe(4001);
    expect(host.sock.last()).toEqual({ type: 'peer', connected: false });
    expect(host.sock.closed).toBeNull();
  });
});
