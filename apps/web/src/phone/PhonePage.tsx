// The phone controller, served at /c/:session?t=…: hold the phone sideways like a steering wheel.
// Steering comes only from the phone's gyro (motion sensors); the on-screen wheel just shows the angle. The pedals are analogue, and the
// indicator stalks and handbrake light up from the car's state, which the simulator sends back.
import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { PhoneCommand, SensorStatus } from '@lplate/shared';
import { steerFromAngle, wheelAngle } from './tilt.ts';
import { ControllerLink, parseControllerUrl, type LinkStatus } from './link.ts';
import './phone.css';

const SEND_HZ = 30;
/** No orientation events this long after start means there is no usable sensor. */
const SENSOR_TIMEOUT_MS = 1500;
/** Wheel graphic turns this far at full lock (visual only). */
const WHEEL_LOCK_DEG = 120;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const buzz = (ms = 12) => navigator.vibrate?.(ms);

export default function PhonePage() {
  const ids = useMemo(() => parseControllerUrl(), []);
  if (!ids) return <Notice title="Scan the QR code" text="Open this page by scanning the QR code on the L-Plate screen." />;
  return <Controller session={ids.session} token={ids.token} />;
}

function Controller({ session, token }: { session: string; token: string }) {
  const link = useMemo(() => new ControllerLink(session, token), [session, token]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [started, setStarted] = useState(false);
  const [sensor, setSensor] = useState<SensorStatus | null>(null);

  // Live input lives in refs so the 30 Hz send loop never waits on React.
  const tilt = useRef<{ angle: number; flat: boolean } | null>(null);
  const centre = useRef<number | null>(null);
  const throttle = useRef(0);
  const brake = useRef(0);
  const wheelEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    link.onChange = rerender;
    link.start();
    return () => link.stop();
  }, [link]);

  /** Steering comes only from the phone's motion sensors (gyro + accelerometer fusion). */
  function currentSteer(): number {
    const t = tilt.current;
    if (!t || t.flat || centre.current === null) return 0;
    return steerFromAngle(t.angle, centre.current);
  }

  // Orientation listener, sensor status, and the send loop. All start on the first tap.
  useEffect(() => {
    if (!started) return;
    let gotEvent = false;
    const reportSensor = (s: SensorStatus) => {
      link.setSensor(s);
      setSensor(s);
    };
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      gotEvent = true;
      const w = wheelAngle(e.beta, e.gamma);
      tilt.current = w;
      if (centre.current === null && !w.flat) centre.current = w.angle;
      reportSensor(w.flat ? 'flat' : 'ok');
    };
    if (sensor !== 'denied' && sensor !== 'unavailable') window.addEventListener('deviceorientation', onOrientation);
    const timeout = window.setTimeout(() => !gotEvent && reportSensor(sensor === 'denied' ? 'denied' : 'unavailable'), SENSOR_TIMEOUT_MS);

    const send = window.setInterval(() => {
      link.send({ type: 'controls', steer: clamp(currentSteer(), -1, 1), throttle: throttle.current, brake: brake.current });
    }, 1000 / SEND_HZ);

    let raf = 0;
    const draw = () => {
      if (wheelEl.current) wheelEl.current.style.transform = `rotate(${currentSteer() * WHEEL_LOCK_DEG}deg)`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // Lift off the pedals if the page is hidden mid-drive (screen lock, app switch).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        return;
      }
      throttle.current = 0;
      brake.current = 0;
      link.send({ type: 'controls', steer: 0, throttle: 0, brake: 0 });
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timeout);
      clearInterval(send);
      cancelAnimationFrame(raf);
    };
  }, [started, link]);

  async function start() {
    // Fullscreen must be requested synchronously inside the tap; iPhone Safari ignores it.
    document.documentElement
      .requestFullscreen?.()
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
    requestWakeLock();

    // iOS 13+ needs an explicit permission prompt, and only from a tap.
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    const DME = window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    let status: SensorStatus | null = null;
    if (!DOE || !window.isSecureContext) status = 'unavailable';
    else if (typeof DOE.requestPermission === 'function') {
      try {
        // Ask for both: orientation (the wheel angle) and motion (the gyro behind it).
        const [o, m] = await Promise.all([DOE.requestPermission(), DME?.requestPermission?.() ?? Promise.resolve('granted')]);
        if (o !== 'granted' || m !== 'granted') status = 'denied';
      } catch {
        status = 'denied';
      }
    }
    if (status) {
      link.setSensor(status);
      setSensor(status);
    }
    buzz(20);
    setStarted(true);
  }

  function command(c: PhoneCommand) {
    buzz();
    link.send({ type: 'command', command: c });
  }

  function recentre() {
    buzz();
    centre.current = tilt.current && !tilt.current.flat ? tilt.current.angle : null;
  }

  if (link.status === 'expired') return <Notice title="This link has expired" text="Scan the QR code on the L-Plate screen again." />;
  if (link.status === 'replaced') return <Notice title="Another phone took over" text="Only one phone can drive at a time. Scan the QR code again to take back control." />;

  const host = link.host;
  const tiltWorks = sensor === 'ok' || sensor === 'flat';

  return (
    <div className="ph-root">
      <div className="ph-portrait-hint">Turn your phone sideways and hold it like a steering wheel (turn off rotation lock if it won't turn).</div>

      <header className="ph-top">
        <Stalk dir="left" on={host?.indicator === 'left'} lit={host?.indicator === 'left' && host.indicatorLit} onPress={() => command('indicator-left')} />
        <div className="ph-mid-buttons">
          <button className={`ph-btn ${host?.handbrake ? 'ph-btn-on' : ''}`} onClick={() => command('handbrake')}>
            <span className="ph-hb-icon">(P)</span> Handbrake
          </button>
          <button className={`ph-btn ${host?.gear === 'R' ? 'ph-btn-on' : ''}`} onClick={() => command('reverse')}>
            {host?.gear === 'R' ? 'R · Reverse' : 'D · Reverse?'}
          </button>
          <button className="ph-btn" onClick={() => command('recover')}>Recover</button>
          <button className="ph-btn" onClick={recentre} disabled={!tiltWorks}>Recentre</button>
        </div>
        <Stalk dir="right" on={host?.indicator === 'right'} lit={host?.indicator === 'right' && host.indicatorLit} onPress={() => command('indicator-right')} />
      </header>

      <main className="ph-controls">
        <Pedal label="Brake" kind="brake" value={brake} />
        <Wheel wheelRef={wheelEl} speed={host?.speedMph ?? null} status={link.status} sensor={sensor} />
        <Pedal label="Accelerate" kind="throttle" value={throttle} />
      </main>

      {!started && (
        <div className="ph-overlay">
          <h1>L-Plate</h1>
          <p className="ph-status">{statusText(link.status)}</p>
          <button className="ph-start" onClick={start}>Tap to start</button>
          <p className="ph-help">Hold the phone sideways like a steering wheel and turn it to steer: the phone's gyro is the wheel. Left thumb brakes, right thumb accelerates: slide up the pedal to press harder. Stop, then press Reverse to back up.</p>
        </div>
      )}
    </div>
  );
}

function statusText(s: LinkStatus): string {
  if (s === 'paired') return 'Connected to the car';
  if (s === 'waiting') return 'Waiting for the L-Plate screen…';
  return 'Connecting…';
}

function sensorText(s: SensorStatus | null): string | null {
  if (s === 'flat') return 'Lift the phone up to steer';
  if (s === 'denied') return 'Motion access denied: allow Motion & Orientation for this site to steer';
  if (s === 'unavailable') return 'No motion sensor: open this page over HTTPS (pnpm tunnel) on a phone';
  return null;
}

/** Analogue pedal: any touch gives 20%, sliding up to the top gives 100%. */
function Pedal({ label, kind, value }: { label: string; kind: 'brake' | 'throttle'; value: RefObject<number> }) {
  const [shown, setShown] = useState(0);
  const pointer = useRef<number | null>(null);

  const update = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = 0.2 + 0.8 * clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    value.current = v;
    setShown(v);
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointer.current) return;
    pointer.current = null;
    value.current = 0;
    setShown(0);
  };

  return (
    <div
      className={`ph-pedal ph-pedal-${kind} ${shown > 0 ? 'ph-pedal-down' : ''}`}
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        buzz(8);
        update(e);
      }}
      onPointerMove={(e) => e.pointerId === pointer.current && update(e)}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="ph-pedal-fill" style={{ height: `${shown * 100}%` }} />
      <span className="ph-pedal-label">{label}</span>
    </div>
  );
}

function Wheel({
  wheelRef,
  speed,
  status,
  sensor,
}: {
  wheelRef: RefObject<HTMLDivElement | null>;
  speed: number | null;
  status: LinkStatus;
  sensor: SensorStatus | null;
}) {
  const hint = sensorText(sensor);

  return (
    // Display only: the wheel turns with the phone's gyro; touching it does nothing.
    <div className="ph-wheel-area">
      <div className="ph-wheel" ref={wheelRef}>
        <svg viewBox="-100 -100 200 200" aria-hidden="true">
          <circle r="88" className="ph-wheel-rim" />
          <path d="M -84 -6 L -26 -6 Q 0 -22 26 -6 L 84 -6 L 84 10 L 22 14 L 10 80 L -10 80 L -22 14 L -84 10 Z" className="ph-wheel-spokes" />
          <rect x="-4" y="-96" width="8" height="16" rx="2" className="ph-wheel-mark" />
        </svg>
      </div>
      <div className="ph-readout">
        <div className="ph-speed">{speed ?? '–'}</div>
        <div className="ph-mph">mph</div>
      </div>
      <div className={`ph-conn ph-conn-${status}`}>{statusText(status)}</div>
      {hint && <div className="ph-sensor-hint">{hint}</div>}
    </div>
  );
}

function Stalk({ dir, on, lit, onPress }: { dir: 'left' | 'right'; on: boolean; lit: boolean; onPress: () => void }) {
  return (
    <button className={`ph-stalk ${on ? 'ph-stalk-on' : ''} ${lit ? 'ph-stalk-lit' : ''}`} onClick={onPress} aria-label={`Indicate ${dir}`}>
      {dir === 'left' ? '◀' : '▶'}
    </button>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="ph-root ph-notice">
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}

function requestWakeLock() {
  (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock?.request('screen').catch(() => {});
}
