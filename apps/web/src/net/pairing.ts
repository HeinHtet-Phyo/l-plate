// Host-side pairing: create a session, keep it in sessionStorage, relay controls from the phone.
import type { AppConfig, ControllerMessage, HostMessage, PairResponse, ServerMessage, SensorStatus } from '@lplate/shared';
import type { Controls } from '../sim/vehicle.ts';

const KEY = 'lplate.pairing';

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

/** Base URL for the phone link: public HTTPS origin, else PUBLIC_URL, else ngrok, else LAN. */
export function controllerBase(cfg: AppConfig | null): { base: string; lan: boolean } {
  const isPublicHttps = location.protocol === 'https:' && !/^(localhost|127\.|192\.168\.|10\.|172\.)/.test(location.hostname);
  if (isPublicHttps) return { base: location.origin, lan: false };
  if (cfg?.publicUrl) return { base: cfg.publicUrl, lan: false };
  if (cfg?.lanUrls.length) return { base: cfg.lanUrls[0], lan: true };
  return { base: location.origin, lan: true };
}

export class HostLink {
  pairing: PairResponse | null = null;
  ws: WebSocket | null = null;
  phoneConnected = false;
  sensor: SensorStatus | null = null;
  controls: Controls | null = null;
  commands: string[] = [];
  lastControls = 0;
  onChange: () => void = () => {};
  private ping: number | undefined;
  private closed = false;
  private retry: number | undefined;

  async start() {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) this.pairing = JSON.parse(saved);
    } catch {
      /* storage unavailable */
    }
    if (!this.pairing) {
      const res = await fetch('/api/pair', { method: 'POST' });
      if (!res.ok) throw new Error('pairing unavailable');
      this.pairing = (await res.json()) as PairResponse;
      try {
        sessionStorage.setItem(KEY, JSON.stringify(this.pairing));
      } catch {
        /* ignore */
      }
    }
    this.connect();
  }

  private connect() {
    if (!this.pairing || this.closed) return;
    const p = this.pairing;
    const ws = new WebSocket(wsUrl(`/ws?role=host&session=${p.sessionId}&token=${p.hostToken}`));
    this.ws = ws;
    ws.onmessage = (ev) => {
      let m: (ServerMessage | ControllerMessage) & { type: string };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === 'peer') {
        this.phoneConnected = (m as { connected: boolean }).connected;
        if (!this.phoneConnected) this.controls = null;
        this.onChange();
      } else if (m.type === 'controls') {
        const c = m as Extract<ControllerMessage, { type: 'controls' }>;
        this.controls = { steer: c.steer, throttle: c.throttle, brake: c.brake };
        this.lastControls = performance.now();
      } else if (m.type === 'command') {
        this.commands.push((m as Extract<ControllerMessage, { type: 'command' }>).command);
      } else if (m.type === 'sensor') {
        this.sensor = (m as Extract<ControllerMessage, { type: 'sensor' }>).status;
        this.onChange();
      } else if (m.type === 'error') {
        // Session expired (server restarted): start a fresh one.
        try {
          sessionStorage.removeItem(KEY);
        } catch {
          /* ignore */
        }
        this.pairing = null;
        ws.close();
        this.start().catch(() => {});
      }
    };
    ws.onclose = () => {
      clearInterval(this.ping);
      this.phoneConnected = false;
      this.onChange();
      if (!this.closed && this.pairing) this.retry = window.setTimeout(() => this.connect(), 2000);
    };
    ws.onopen = () => {
      this.ping = window.setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), 15_000);
    };
  }

  /** Phone controls, or null when stale (> 1 s old) or not connected. */
  phoneControls(): Controls | null {
    if (!this.phoneConnected || !this.controls) return null;
    if (performance.now() - this.lastControls > 1000) return null;
    return this.controls;
  }

  sendState(s: Extract<HostMessage, { type: 'state' }>) {
    this.send(s);
  }

  /** Any host → phone message; dropped when no phone is connected. */
  send(m: HostMessage) {
    if (this.ws?.readyState === 1 && this.phoneConnected) this.ws.send(JSON.stringify(m));
  }

  controllerUrl(base: string): string | null {
    if (!this.pairing) return null;
    return `${base.replace(/\/$/, '')}/c/${this.pairing.sessionId}?t=${this.pairing.controllerToken}`;
  }

  stop() {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.ping);
    this.ws?.close();
  }
}
