// App shell: menu ↔ drive, URL shortcuts (?route=, ?start=, &weather=, &voice=0, &mirrors=0, &map=0).
import { useEffect, useMemo, useState } from 'react';
import type { AppConfig, TestRoute } from '@lplate/shared';
import { HostLink } from '../net/pairing.ts';
import { detectGpu } from '../sim/gpu.ts';
import { PRESETS, type PresetId } from '../sim/conditions.ts';
import { Drive } from './Drive.tsx';
import { PhonePanel } from './PhonePanel.tsx';
import { KEYS } from './Hud.tsx';
import routesJson from '../routes/test-routes.json';
import startsJson from '../routes/free-starts.json';
import './app.css';

const ROUTES = routesJson as unknown as TestRoute[];
const STARTS = startsJson as { id: string; name: string; area: string; note: string }[];
const READY = new Set(['goodmayes', 'mill-hill', 'isleworth', 'morden', 'the-mall', 'westminster-bridge', 'tower-bridge', 'holland-park']);

type Pick = { kind: 'route' | 'free'; id: string };

function readUrl(): { pick: Pick | null; weather: 'live' | PresetId; voice: boolean; mirrors: boolean; map: boolean } {
  const q = new URLSearchParams(location.search);
  const w = q.get('weather');
  const route = q.get('route');
  const start = q.get('start');
  return {
    pick: route ? { kind: 'route', id: route } : start ? { kind: 'free', id: start } : null,
    weather: w && w in PRESETS ? (w as PresetId) : 'live',
    voice: q.get('voice') !== '0',
    mirrors: q.get('mirrors') !== '0',
    map: q.get('map') !== '0',
  };
}

function getStored(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? dflt : v === '1';
  } catch {
    return dflt;
  }
}

export default function App() {
  const url = useMemo(readUrl, []);
  const gpu = useMemo(detectGpu, []);
  const host = useMemo(() => new HostLink(), []);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [pick, setPick] = useState<Pick>(url.pick ?? { kind: 'route', id: 'goodmayes' });
  const [weather, setWeather] = useState<'live' | PresetId>(url.weather);
  const [instructor, setInstructor] = useState(() => getStored('lplate.instructor', true));
  const [driving, setDriving] = useState(url.pick != null);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    host.start().catch(() => {});
    fetch('/api/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg({ publicUrl: null, lanUrls: [], instructor: false }));
  }, []);

  const setUrl = (p: Pick | null) => {
    const q = new URLSearchParams(location.search);
    q.delete('route');
    q.delete('start');
    if (p) q.set(p.kind === 'route' ? 'route' : 'start', p.id);
    if (weather !== 'live' && p) q.set('weather', weather);
    else q.delete('weather');
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
  };

  if (driving) {
    return (
      <Drive
        key={runId}
        kind={pick.kind}
        id={pick.id}
        weather={weather}
        voice={url.voice}
        instructor={instructor}
        instructorAvailable={cfg?.instructor ?? true}
        mirrors={url.mirrors}
        host={host}
        gpu={gpu}
        onExit={() => {
          setDriving(false);
          setUrl(null);
        }}
        onRestart={() => setRunId((n) => n + 1)}
      />
    );
  }

  return (
    <div className="menu">
      <header>
        <h1>
          <span className="lplate">L</span> L-Plate
        </h1>
        <p className="pitch">Practise for your driving test on real London streets, with Sam, an AI instructor running on Nebius Token Factory.</p>
      </header>

      <section>
        <h2>Driving test routes</h2>
        <p className="muted">Typical routes from real DVSA test centres, not official. DVSA doesn't publish test routes.</p>
        <div className="cards">
          {ROUTES.map((r) => (
            <button
              key={r.id}
              className={`card ${pick.kind === 'route' && pick.id === r.id ? 'selected' : ''}`}
              disabled={!READY.has(r.id)}
              onClick={() => setPick({ kind: 'route', id: r.id })}
            >
              <div className="card-title">{r.centre.name}</div>
              <div className="card-sub">{r.name}</div>
              <div className="card-meta">
                {(r.distance / 1609.344).toFixed(1)} miles · {Math.round((r.duration * 1.6) / 60)} min
              </div>
              <div className="chips">
                {r.features.slice(0, 4).map((f) => (
                  <span key={f} className="chip">
                    {f}
                  </span>
                ))}
              </div>
              {!READY.has(r.id) && <div className="muted small">Map data still loading</div>}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Free drive</h2>
        <div className="cards">
          {STARTS.map((s) => (
            <button key={s.id} className={`card ${pick.kind === 'free' && pick.id === s.id ? 'selected' : ''}`} onClick={() => setPick({ kind: 'free', id: s.id })}>
              <div className="card-title">{s.name}</div>
              <div className="card-sub">{s.area}</div>
              <div className="muted small">{s.note}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="row3">
        <div className="panel">
          <h3>Conditions</h3>
          <select value={weather} onChange={(e) => setWeather(e.target.value as 'live' | PresetId)}>
            <option value="live">Live London weather and time</option>
            {Object.entries(PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.description} (preset)
              </option>
            ))}
          </select>
        </div>
        <div className="panel">
          <h3>AI instructor</h3>
          <label className="toggle">
            <input
              type="checkbox"
              checked={instructor}
              onChange={(e) => {
                setInstructor(e.target.checked);
                try {
                  localStorage.setItem('lplate.instructor', e.target.checked ? '1' : '0');
                } catch {
                  /* ignore */
                }
              }}
            />
            Sam speaks directions and feedback
          </label>
          <p className="muted small">
            {cfg == null ? 'Checking the server…' : cfg.instructor ? 'AI instructor on Nebius Token Factory.' : 'Sam is unavailable: the server has no NEBIUS_API_KEY (or is down). Everything else works.'}
          </p>
        </div>
        <div className="panel">
          <h3>Graphics</h3>
          <p>{gpu.name}</p>
          {gpu.software ? (
            <p className="warn small">
              Software rendering detected. Turn on hardware acceleration: Chrome/Edge Settings → System → "Use graphics acceleration when available", or chrome://flags/#ignore-gpu-blocklist.
            </p>
          ) : (
            <p className="muted small">Hardware accelerated{gpu.webgl2 ? ', WebGL 2' : ''}.</p>
          )}
        </div>
      </section>

      <section className="row3">
        <div className="panel">
          <PhonePanel host={host} />
        </div>
        <div className="panel">
          <h3>Keyboard</h3>
          <table className="keys">
            <tbody>
              {KEYS.map(([k, a]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel start">
          <button
            className="primary big"
            onClick={() => {
              setUrl(pick);
              setDriving(true);
            }}
          >
            Start driving
          </button>
          <p className="muted small">
            {pick.kind === 'route' ? ROUTES.find((r) => r.id === pick.id)?.centre.name : STARTS.find((s) => s.id === pick.id)?.name}
          </p>
        </div>
      </section>

      <footer className="muted small">
        Map data © OpenStreetMap contributors (ODbL) · routes from OSRM · test centre details from GOV.UK · weather by Open-Meteo (CC BY 4.0) · AI instructor on Nebius Token Factory
      </footer>
    </div>
  );
}
