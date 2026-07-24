import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

/* Root picker.
     - iOS + gh-pages preview:  __KYC_WEB__ is false → always App.
       The lazy() ternary constant-folds to null and Rollup drops the
       marketing module from the iOS bundle entirely.
     - reelintel.ai web deploy: __KYC_WEB__ is true → path split.
         /                → marketing landing
         /admin           → App (which routes to the admin console for
                            allow-listed emails once signed in)
         /reset-password  → ResetPasswordPage (Supabase parses the
                            recovery access token in the URL fragment
                            via detectSessionInUrl so the page can
                            call updateUser({ password }))
         any other path   → treat as marketing (spare a bad URL a 404) */
const MarketingLanding    = __KYC_WEB__
  ? lazy(() => import('./screens_marketing.jsx').then(m => ({ default: m.MarketingLanding })))
  : null;
const ResetPasswordPage   = __KYC_WEB__
  ? lazy(() => import('./screens_marketing.jsx').then(m => ({ default: m.ResetPasswordPage })))
  : null;

function pickRoot() {
  if (!__KYC_WEB__ || !MarketingLanding) return <App />;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin') {
    if (window.location.hash !== '#/admin') window.location.hash = '#/admin';
    return <App />;
  }
  if (path === '/reset-password') {
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0A1B2E' }} />}>
        <ResetPasswordPage />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0A1B2E' }} />}>
      <MarketingLanding />
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{pickRoot()}</React.StrictMode>
);
