// Entry: the phone page (/c/:session) loads without the 3D code. No <StrictMode>: double-run
// effects would open duplicate sessions and sockets.
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const phonePages = import.meta.glob<{ default: React.ComponentType }>('./phone/PhonePage.tsx');
const phoneLoader = Object.values(phonePages)[0];

const isPhone = location.pathname.startsWith('/c/');
const Page = isPhone
  ? lazy(phoneLoader ?? (async () => ({ default: () => <p style={{ padding: 24 }}>The phone controller isn't built yet.</p> })))
  : lazy(() => import('./app/App.tsx'));

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
    <Page />
  </Suspense>,
);
