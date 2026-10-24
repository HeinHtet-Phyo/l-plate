// Entry: the phone page (/c/:session) loads without the 3D code. No <StrictMode>: double-run
// effects would open duplicate sessions and sockets.
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const phonePages = import.meta.glob<{ default: React.ComponentType }>('./phone/PhonePage.tsx');
const phoneLoader = Object.values(phonePages)[0];

const isPhone = location.pathname.startsWith('/c/');
// /referee replays a sample drive to several examiner models (the "where models struggle" demo).
const isReferee = location.pathname.startsWith('/referee');
const Page = isPhone
  ? lazy(phoneLoader ?? (async () => ({ default: () => <p style={{ padding: 24 }}>The phone controller isn't built yet.</p> })))
  : isReferee
    ? lazy(() => import('./referee/Referee.tsx'))
    : lazy(() => import('./app/App.tsx'));

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
    <Page />
  </Suspense>,
);
