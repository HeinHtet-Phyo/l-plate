// QR code and pairing status for the phone steering wheel.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { AppConfig } from '@lplate/shared';
import { controllerBase, type HostLink } from '../net/pairing.ts';

export function PhonePanel({ host }: { host: HostLink }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg({ publicUrl: null, lanUrls: [], instructor: false }));
    const prev = host.onChange;
    host.onChange = () => {
      prev();
      force((n) => n + 1);
    };
    return () => {
      host.onChange = prev;
    };
  }, [host]);

  const { base, lan } = controllerBase(cfg);
  const url = host.controllerUrl(base);
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [url]);

  return (
    <div className="phone-panel">
      <h3>Phone steering wheel</h3>
      {qr ? <img src={qr} width={220} height={220} alt="QR code to pair your phone" /> : <p>Starting pairing…</p>}
      <p className="status">{host.phoneConnected ? '● Phone connected' : '○ Waiting for your phone'}</p>
      {host.sensor && host.sensor !== 'ok' ? <p className="muted">Phone sensors: {host.sensor} (touch steering works)</p> : null}
      {lan ? <p className="muted">Over the LAN, iOS won't share motion sensors on plain HTTP: touch steering is the fallback. Run <code>pnpm tunnel</code> for HTTPS.</p> : null}
      {url ? (
        <p className="muted small">
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </p>
      ) : null}
    </div>
  );
}
