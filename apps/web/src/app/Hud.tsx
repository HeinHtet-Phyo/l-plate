// Drive-screen HUD, lesson summary and overlays. Re-renders ~10×/s from the session store.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Session } from '../sim/session.ts';
import type { GpuInfo } from '../sim/gpu.ts';
import type { HostLink } from '../net/pairing.ts';
import { PhonePanel } from './PhonePanel.tsx';

export const KEYS: [string, string][] = [
  ['W / ↑', 'accelerate'],
  ['S / ↓', 'brake'],
  ['A D / ← →', 'steer'],
  ['Q / E', 'indicators'],
  ['Space', 'handbrake'],
  ['R', 'recover'],
  ['G', 'reverse / drive (when stopped)'],
  ['V', 'push-to-talk'],
  ['P', 'phone panel'],
  ['H', 'help'],
  ['`', 'debug'],
  ['Esc', 'exit'],
];

function NavArrow({ type, modifier, exit }: { type?: string; modifier?: string; exit?: number }) {
  if (type === 'roundabout' || type === 'rotary') {
    return (
      <div className="nav-arrow">
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden>
          <circle cx="24" cy="26" r="9" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M24 46 V35" stroke="currentColor" strokeWidth="4" />
        </svg>
        {exit ? <span className="exit-no">{exit}</span> : null}
      </div>
    );
  }
  const m = modifier ?? 'straight';
  const rot = m.includes('sharp left') ? -135 : m.includes('slight left') ? -45 : m.includes('left') ? -90 : m.includes('sharp right') ? 135 : m.includes('slight right') ? 45 : m.includes('right') ? 90 : m === 'uturn' ? 180 : 0;
  return (
    <div className="nav-arrow">
      <svg viewBox="0 0 48 48" width="44" height="44" style={{ transform: `rotate(${rot}deg)` }} aria-hidden>
        <path d="M24 44 V10 M12 22 L24 8 L36 22" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Hud({ session, gpu, host, onExit, onRestart, attribution, infill }: { session: Session; gpu: GpuInfo; host: HostLink | null; onExit: () => void; onRestart: () => void; attribution: string; infill: boolean }) {
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [typed, setTyped] = useState('');
  const c = session.conditions;

  useEffect(() => {
    if (s.exit) onExit();
  }, [s.exit]);

  const cond = `${c.description}${c.temperature != null ? ` · ${Math.round(c.temperature)}°C` : ''} · ${c.source === 'default' ? 'weather unavailable' : c.source}`;
  const hour = Math.floor(c.hour);
  const mins = Math.round((c.hour - hour) * 60);
  const traffic = `Traffic: ${s.trafficSource} for ${c.weekend ? 'weekend' : 'weekday'} ${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')} · ${s.carsNearby} cars nearby`;
  const nav = s.nav;

  return (
    <div className="hud">
      <div className="place panel">
        <div className="road">{s.road || 'Unnamed road'}</div>
        <div className="row">
          {s.limit ? <span className="limit">{s.limit}</span> : null}
          <span className="speed">
            {s.speedMph}
            <small> mph</small>
          </span>
          <span className={`ind ${s.indicator === 'left' && s.indicatorLit ? 'on' : ''}`}>◀</span>
          <span className={`ind ${s.indicator === 'right' && s.indicatorLit ? 'on' : ''}`}>▶</span>
          <span className={`gear ${s.gear === 'R' ? 'rev' : ''}`}>{s.gear}</span>
          {s.handbrake ? <span className="hb">(P) handbrake</span> : null}
        </div>
        {s.onPavement ? <div className="warn">You're on the pavement</div> : null}
      </div>

      {nav && (
        <div className={`navbar panel ${nav.status === 'off' || nav.status === 'rerouting' ? 'amber' : ''}`}>
          <NavArrow type={nav.next?.type} modifier={nav.next?.modifier} exit={nav.next?.exit} />
          <div>
            <div className="nav-dist">{nav.status === 'rerouting' ? 'Recalculating…' : nav.status === 'off' ? 'Off route' : nav.distanceText}</div>
            <div className="nav-instr">{nav.instruction}</div>
            {nav.thenText ? <div className="nav-then">then {nav.thenText}</div> : null}
            <div className="nav-eta">
              {nav.milesLeft} mi left · arrive {new Date(Date.now() + nav.etaSeconds * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}
            </div>
          </div>
        </div>
      )}

      <div className="topright">
        <button onClick={() => session.toggle('phone')}>Phone{s.phoneConnected ? ' ●' : ''}</button>
        <button onClick={() => session.toggle('help')}>Controls</button>
        {!s.finished && <button className="primary" onClick={() => session.finish()}>Finish lesson</button>}
        <button onClick={onExit}>Exit</button>
      </div>

      <div className="toasts">
        {s.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>

      {s.caption && (
        <div className="caption">
          <b>{s.caption.startsWith('You:') ? '' : 'Sam: '}</b>
          {s.caption}
        </div>
      )}
      {s.listening && <div className="listening">● Listening… release V to send</div>}
      {s.typing && (
        <form
          className="typebox panel"
          onSubmit={(e) => {
            e.preventDefault();
            session.learnerSays(typed);
            setTyped('');
            session.closeTyping();
          }}
        >
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Ask Sam something…" onKeyDown={(e) => e.key === 'Escape' && session.closeTyping()} />
          <button type="submit">Ask</button>
        </form>
      )}

      <div className="conditions panel">
        <div>{cond}</div>
        <div>{traffic}</div>
        <div className="muted">
          Sam: {s.instructor === 'on' ? 'on (Nebius Token Factory)' : s.instructor === 'off' ? 'off' : 'unavailable'} · faults {s.faults}
          {gpu.software ? ' · software rendering!' : ''}
        </div>
      </div>

      <div className="attribution">
        {attribution}
        {infill ? ' · Houses filled in where OpenStreetMap has none mapped' : ''} · routes OSRM · weather Open-Meteo
      </div>

      {s.showHelp && (
        <div className="overlay" onClick={() => session.toggle('help')}>
          <div className="panel help">
            <h3>Controls</h3>
            <table>
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
            <p className="muted">Click anywhere to close.</p>
          </div>
        </div>
      )}

      {s.showDebug && (
        <div className="debug panel">
          <div>GPU: {gpu.name}</div>
          {Object.entries(s.debug).map(([k, v]) => (
            <div key={k}>
              {k}: {v}
            </div>
          ))}
        </div>
      )}

      {s.showPhone && host && (
        <div className="overlay" onClick={() => session.toggle('phone')}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <PhonePanel host={host} />
          </div>
        </div>
      )}

      {s.instructorNote && s.instructor === 'unavailable' && <div className="note">{s.instructorNote}</div>}

      {s.finished && (
        <div className="overlay">
          <div className="panel summary">
            {s.debriefLoading || !s.debrief ? (
              <>
                <div className="spinner" />
                <p>The examiner (Nebius) is writing your debrief…</p>
              </>
            ) : (
              <>
                <div className={`result ${s.debrief.result}`}>{s.debrief.result === 'pass' ? 'Pass' : 'Fail'}</div>
                <p>{s.debrief.summary}</p>
                {s.debrief.modelResult && s.debrief.modelResult !== s.debrief.result && (
                  <p className="muted">The examiner model said "{s.debrief.modelResult}"; the DVSA rule overrides it.</p>
                )}
                {s.debrief.faults.length > 0 && (
                  <table className="faults">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Severity</th>
                        <th>Count</th>
                        <th>Advice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.debrief.faults.map((f) => (
                        <tr key={f.category}>
                          <td>{f.category}</td>
                          <td className={`sev ${f.severity}`}>{f.severity}</td>
                          <td>{f.count}</td>
                          <td>{f.advice}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {s.debrief.focusNext.length > 0 && (
                  <>
                    <h4>Practise next</h4>
                    <ul>
                      {s.debrief.focusNext.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="muted">{s.debrief.source === 'nebius' ? 'Debrief by the examiner model on Nebius Token Factory.' : 'Offline rule-based debrief (Nebius unavailable).'}</p>
                <div className="buttons">
                  <button className="primary" onClick={onRestart}>
                    Drive again
                  </button>
                  <button onClick={onExit}>Back to menu</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
