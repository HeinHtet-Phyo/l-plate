// Model referee: replay one drive's fault log to several examiner models and score each against
// the DVSA rule. This is the "where the models struggle" screen for the demo.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebriefRequest, RefereeEntry, RefereeResponse } from '@lplate/shared';
import '../app/app.css';
import './referee.css';

/** A Goodmayes drive with five faults, one of them serious, for demoing without driving. */
export const SAMPLE_REQUEST: DebriefRequest = {
  route: 'Goodmayes (Goodmayes Driving Test Centre)',
  faults: [
    { kind: 'speeding', category: 'Speed limits', text: '37 mph in a 30 for 5 s', road: 'Goodmayes Road', time: 84 },
    { kind: 'signal', category: 'Signals – necessary', text: 'Turned left without indicating', road: 'Green Lane', time: 162 },
    { kind: 'redLight', category: 'Response to signals – traffic lights', text: 'Drove through a red light', road: 'High Road', time: 241 },
    { kind: 'centreLine', category: 'Positioning – normal driving', text: 'Drove over the centre line', road: 'Barley Lane', time: 318 },
    { kind: 'kerb', category: 'Control – steering (Junctions – turning at junctions)', text: 'Clipped the kerb turning right', road: 'Mayesbrook Road', time: 402 },
  ],
  stats: { distance: 5600, duration: 540, maxSpeedOverLimit: 7 },
};

const shortName = (m: string) => m.split('/').pop() ?? m;
const pct = (n: number) => Math.round(Math.max(0, Math.min(100, n)));
const scoreClass = (n: number) => (n >= 80 ? 'good' : n >= 50 ? 'mid' : 'bad');

export function Referee({ request, onClose }: { request: DebriefRequest; onClose?: () => void }) {
  const [res, setRes] = useState<RefereeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const run = useRef(0);

  const start = useCallback(async () => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    setRes(null);
    const t0 = performance.now();
    const tick = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    try {
      const r = await fetch('/api/referee', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const j = await r.json().catch(() => null);
      if (id !== run.current) return;
      if (!r.ok || !j?.entries) throw new Error(j?.error ?? `The referee endpoint returned HTTP ${r.status}`);
      setRes(j as RefereeResponse);
    } catch (e) {
      if (id === run.current) setError((e as Error).message);
    } finally {
      clearInterval(tick);
      if (id === run.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const n = res?.entries.length ?? 0;
  // The browser's fault checker treats red lights and collisions as serious (as the phone buzz does).
  const serious = request.faults.filter((f) => f.kind === 'redLight' || f.kind === 'collision').length;

  return (
    <div className="ref">
      <header className="ref-head">
        <div>
          <h2>Same drive, {n || 'several'} examiner models</h2>
          <p className="muted">
            {request.faults.length} faults logged on {request.route}. Every model gets the same prompt and the same JSON schema.
          </p>
        </div>
        <div className="ref-verdict">
          {res ? (
            <>
              <span className="muted">DVSA rule says</span>
              <strong className={`result ${res.reference}`}>{res.reference.toUpperCase()}</strong>
              <span className="muted">
                {serious ? `${serious} serious · ` : ''}
                {res.faultCount} faults in the log
              </span>
            </>
          ) : (
            <span className="muted">Checking against the DVSA rule…</span>
          )}
        </div>
        <div className="ref-actions">
          <button className="primary" onClick={() => void start()} disabled={loading}>
            {loading ? 'Running…' : res || error ? 'Re-run' : 'Run'}
          </button>
          {onClose && <button onClick={onClose}>Close</button>}
        </div>
      </header>

      {loading && (
        <div className="ref-loading">
          <div className="spinner" />
          <p>
            Asking the examiner models on Nebius… <strong>{elapsed.toFixed(1)} s</strong>
          </p>
          <p className="muted">Models answer at different speeds; the slowest one sets the wait.</p>
        </div>
      )}

      {error && !loading && (
        <div className="ref-error">
          <strong>The referee couldn't run.</strong> {error}
        </div>
      )}

      {res && !loading && (
        <>
          <div className="ref-grid">
            {[...res.entries]
              .sort((a, b) => b.score - a.score)
              .map((e) => (
                <ModelCard key={e.model} e={e} reference={res.reference} />
              ))}
          </div>
          <footer className="ref-foot">
            <p className="ref-takeaway">{takeaway(res)}</p>
            <p className="muted">All models on Nebius Token Factory, same prompt, same JSON schema. Scores: valid JSON, verdict, self-consistency, fault count and invented rules.</p>
          </footer>
        </>
      )}
    </div>
  );
}

function ModelCard({ e, reference }: { e: RefereeEntry; reference: 'pass' | 'fail' }) {
  const c = e.checks;
  if (!e.ok) {
    return (
      <article className="ref-card failed">
        <div className="ref-card-top">
          <h3 title={e.model}>{shortName(e.model)}</h3>
          <span className="ref-score bad">0</span>
        </div>
        <p className="ref-fail">{friendlyError(e.error)}</p>
        <p className="muted small">{(e.ms / 1000).toFixed(1)} s before giving up</p>
      </article>
    );
  }
  const score = pct(e.score);
  return (
    <article className={`ref-card ${scoreClass(score)}`}>
      <div className="ref-card-top">
        <h3 title={e.model}>{shortName(e.model)}</h3>
        <span className={`ref-score ${scoreClass(score)}`}>{score}</span>
      </div>
      <p className="muted small">
        {(e.ms / 1000).toFixed(1)} s{e.tokens ? ` · ${e.tokens.prompt + e.tokens.completion} tokens (${e.tokens.completion} out)` : ''}
      </p>
      <div className="ref-model-verdict">
        <span className={`result ${c.verdict ?? ''}`}>{c.verdict ? c.verdict.toUpperCase() : '—'}</span>
        <span className={c.verdictMatchesRule ? 'ok' : 'no'}>{c.verdictMatchesRule ? '✓ matches the rule' : `✗ rule says ${reference.toUpperCase()}`}</span>
      </div>
      <ul className="ref-checks">
        <Check ok={c.validJson} label="Valid JSON for the schema" />
        <Check ok={c.verdictMatchesRule} label="Verdict follows the DVSA rule" />
        <Check ok={c.selfConsistent} label="Verdict agrees with its own severities" />
        <Check ok={c.faultCountModel === c.faultCountLog} label={`Fault count: ${c.faultCountModel} vs ${c.faultCountLog} logged`} />
        <Check ok={c.inventedRules.length === 0} label={c.inventedRules.length ? 'Invented Highway Code rules' : `No invented rules${c.citedRules.length ? ` (cited ${c.citedRules.map((r) => `Rule ${r}`).join(', ')})` : ''}`} />
      </ul>
      {c.inventedRules.length > 0 && (
        <ul className="ref-invented">
          {c.inventedRules.map((r) => (
            <li key={r}>Rule {r} doesn't exist</li>
          ))}
        </ul>
      )}
      {e.debrief && (
        <details className="ref-details">
          <summary>Its debrief</summary>
          <p>{e.debrief.summary}</p>
          {e.debrief.faults.length > 0 && (
            <table className="faults">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>#</th>
                </tr>
              </thead>
              <tbody>
                {e.debrief.faults.map((f, i) => (
                  <tr key={`${f.category}-${i}`}>
                    <td>{f.category}</td>
                    <td className={`sev ${f.severity}`}>{f.severity}</td>
                    <td>{f.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      )}
    </article>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? 'ok' : 'no'}>
      <span>{ok ? '✓' : '✗'}</span> {label}
    </li>
  );
}

function friendlyError(err?: string): string {
  if (!err) return 'No answer from this model.';
  if (/\b503\b/.test(err)) return 'Nebius 503: model unavailable right now.';
  if (/\b429\b|529|overloaded/i.test(err)) return 'Rate-limited or overloaded on Nebius.';
  if (/timeout|timed out|abort/i.test(err)) return 'Timed out waiting for the model.';
  if (/json|schema|parse/i.test(err)) return `Broken JSON: ${err.slice(0, 120)}`;
  return err.slice(0, 160);
}

/** One-line summary of the run, e.g. "2 of 3 models got the verdict right; Kimi-K3 invented Rule 412." */
export function takeaway(r: RefereeResponse): string {
  const answered = r.entries.filter((e) => e.ok);
  const failed = r.entries.length - answered.length;
  if (!answered.length) return `None of the ${r.entries.length} models answered (Nebius unavailable). The game falls back to the rule-based debrief.`;
  const right = answered.filter((e) => e.checks.verdictMatchesRule).length;
  const parts = [`${right} of ${r.entries.length} models got the verdict right`];
  for (const e of answered) {
    if (e.checks.inventedRules.length) parts.push(`${shortName(e.model)} invented ${e.checks.inventedRules.map((x) => `Rule ${x}`).join(', ')}`);
    else if (!e.checks.selfConsistent) parts.push(`${shortName(e.model)} contradicted its own severities`);
  }
  if (failed) parts.push(`${failed} didn't answer`);
  const wrong = answered.length - right + answered.filter((e) => e.checks.inventedRules.length && e.checks.verdictMatchesRule).length;
  return `${parts.join('; ')}.${wrong ? " The server's guard overrides the verdict and strips invented rules before the learner sees them." : ''}`;
}

/** Standalone /referee page: replays the built-in sample drive. */
export default function RefereePage() {
  return (
    <div className="ref-page">
      <Referee request={SAMPLE_REQUEST} onClose={() => (location.href = '/')} />
    </div>
  );
}
