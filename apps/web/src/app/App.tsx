// App shell: menu ↔ drive, URL shortcuts (?route=, ?start=, &weather=, &voice=0, &mirrors=0, &map=0).
import { useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '@lplate/shared';
import { HostLink } from '../net/pairing.ts';
import { detectGpu } from '../sim/gpu.ts';
import { PRESETS, type PresetId } from '../sim/conditions.ts';
import { Drive } from './Drive.tsx';
import { PhonePanel } from './PhonePanel.tsx';
import { KEYS } from './Hud.tsx';
import startsJson from '../routes/free-starts.json';
import './app.css';

const STARTS = startsJson as { id: string; name: string; area: string; note: string }[];
const SPLAT_ID = 'elephant-splat';
const SPLAT = STARTS.find((s) => s.id === SPLAT_ID);

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
  const [pick] = useState<Pick>(url.pick ?? { kind: 'free', id: SPLAT_ID });
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
      <header className="hero">
        <h1>
          <span className="lplate">L</span> L-Plate
        </h1>
        <p className="purpose">
          Learner drivers only get a few hours behind the wheel before their test, and every lesson costs money. L-Plate lets you
          practise on a real London street, rebuilt in 3D from real photos, with Sam, an AI driving instructor who gives directions,
          coaches you live and marks your drive like a driving examiner.
        </p>
        <ul className="why">
          <li><b>Real streets</b> · Gaussian splat built from 112 street photos</li>
          <li><b>Real feedback</b> · minor, serious and dangerous faults with the Highway Code rule</li>
          <li><b>Open models</b> · instructor and debrief run on Nebius Token Factory</li>
        </ul>
      </header>

      <section className="map-pick">
        <div className="card selected hero-card">
          <div className="card-kicker">Gaussian-splat map</div>
          <div className="card-title">{SPLAT?.name.replace(' (splat)', '') ?? 'Elephant & Castle'}</div>
          <div className="card-sub">{SPLAT?.area ?? 'Southwark'}, London · 320 m of real street, photo-real</div>
          <div className="muted small">Street imagery © RedAuburn via Panoramax, CC BY-SA 4.0</div>
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
          <p className="muted small">Space releases the handbrake, W to drive</p>
        </div>
      </section>

      <section className="row3">
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
            {cfg == null ? 'Checking the server…' : cfg.instructor ? 'Running on Nebius Token Factory.' : 'Sam is unavailable: the server has no NEBIUS_API_KEY (or is down).'}
          </p>
          <h3 className="gap">Conditions</h3>
          <select value={weather} onChange={(e) => setWeather(e.target.value as 'live' | PresetId)}>
            <option value="live">Live London weather and time</option>
            {Object.entries(PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.description}
              </option>
            ))}
          </select>
        </div>
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
          {gpu.software && <p className="warn small">Software rendering detected: turn on hardware acceleration in your browser settings.</p>}
        </div>
      </section>

      <footer className="muted small">
        Street imagery © RedAuburn via Panoramax (CC BY-SA 4.0) · map data © OpenStreetMap contributors (ODbL) · weather by Open-Meteo (CC BY 4.0) · AI on Nebius Token Factory
      </footer>
    </div>
  );
}
