// Phone-side pairing: join the session from the QR link and stream controls to the simulator.
import type { ControllerMessage, HostMessage, SensorStatus, ServerMessage } from '@lplate/shared';
import { wsUrl } from '../net/pairing.ts';

export type HostState = Extract<HostMessage, { type: 'state' }>;
export type HostFault = Extract<HostMessage, { type: 'fault' }>;
export type HostReport = Extract<HostMessage, { type: 'report' }>;
export type LinkStatus = 'connecting' | 'waiting' | 'paired' | 'replaced' | 'expired';

/** Session ID and token from a /c/:session?t=… URL. */
export function parseControllerUrl(loc: Location = location): { session: string; token: string } | null {
  const m = loc.pathname.match(/^\/c\/([^/]+)/);
  const token = new URLSearchParams(loc.search).get('t');
  return m && token ? { session: decodeURIComponent(m[1]), token } : null;
}

export class ControllerLink {
  status: LinkStatus = 'connecting';
  host: HostState | null = null;
  /** The last lesson's debrief; cleared when the next lesson starts driving. */
  report: HostReport | null = null;
  onChange: () => void = () => {};
  onFault: (f: HostFault) => void = () => {};
  private ws: WebSocket | null = null;
  private closed = false;
  private retry: number | undefined;
  private ping: number | undefined;
  private sensor: SensorStatus | null = null;
  private reportAt = 0;

  constructor(
    private session: string,
    private token: string,
  ) {}

  start() {
    this.connect();
  }

  private set(status: LinkStatus) {
    this.status = status;
    this.onChange();
  }

  private connect() {
    if (this.closed) return;
    const q = `role=controller&session=${encodeURIComponent(this.session)}&token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(wsUrl(`/ws?${q}`));
    this.ws = ws;
    this.set('connecting');
    ws.onopen = () => {
      this.ping = window.setInterval(() => this.send({ type: 'ping' }), 15_000);
      // Re-announce the sensor after a reconnect so the simulator's status is right.
      if (this.sensor) this.send({ type: 'sensor', status: this.sensor });
    };
    ws.onmessage = (ev) => {
      let m: (ServerMessage | HostMessage) & { type: string };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === 'peer') {
        if (!(m as { connected: boolean }).connected) this.host = null;
        this.set((m as { connected: boolean }).connected ? 'paired' : 'waiting');
      } else if (m.type === 'state') {
        this.host = m as HostState;
        if (this.report && this.reportAt && performance.now() - this.reportAt > 3000 && this.host.driving && this.host.speedMph > 0) this.report = null;
        this.onChange();
      } else if (m.type === 'fault') {
        this.onFault(m as HostFault);
      } else if (m.type === 'report') {
        this.report = m as HostReport;
        this.reportAt = performance.now();
        this.onChange();
      } else if (m.type === 'replaced') {
        // Another phone scanned the code; don't fight it for the session.
        this.closed = true;
        this.set('replaced');
      } else if (m.type === 'error') {
        // Unknown session or bad token: the server restarted or the QR code is old.
        this.closed = true;
        this.set('expired');
      }
    };
    ws.onclose = () => {
      clearInterval(this.ping);
      this.host = null;
      if (this.closed) return;
      this.set('connecting');
      this.retry = window.setTimeout(() => this.connect(), 1000);
    };
  }

  send(m: ControllerMessage) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  setSensor(status: SensorStatus) {
    if (status === this.sensor) return;
    this.sensor = status;
    this.send({ type: 'sensor', status });
  }

  stop() {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.ping);
    this.ws?.close();
  }
}
