/* Marketing landing page — rendered at reelintel.ai/ when the app
   is built with KYC_WEB=true. Public, no auth gate. No references
   to /admin anywhere (SEO + defence-in-depth).

   Kept intentionally lightweight — one file, no images beyond the
   public/brand/ assets that the mobile app already ships. */
import React from 'react';
import { Camera, ShieldCheck, BookOpen, Cloud, ArrowRight } from 'lucide-react';
import { T } from './theme.js';

const HEADER_LOGO = `${import.meta.env.BASE_URL}brand/reelintel-horizontal.png`;
const BRAND_LOGO  = `${import.meta.env.BASE_URL}brand/reelintel-brand.png`;
const HERO_IMG    = `${import.meta.env.BASE_URL}brand/hero-tuna.png`;

const TESTFLIGHT_URL = 'https://testflight.apple.com/join/'; // TODO: paste public link once TestFlight is public

function Feature({ icon: Icon, title, body }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 16,
      padding: '20px 20px', flex: 1, minWidth: 240,
    }}>
      <Icon size={26} color={T.brass} strokeWidth={2} />
      <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, marginTop: 10 }}>{title}</div>
      <p style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.55, margin: '6px 0 0' }}>{body}</p>
    </div>
  );
}

export function MarketingLanding() {
  return (
    <div style={{
      minHeight: '100vh', background: T.bgDeep, color: T.parchment,
      fontFamily: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 24px', borderBottom: `1px solid ${T.cardEdge}`,
        maxWidth: 1120, margin: '0 auto',
      }}>
        <img src={HEADER_LOGO} alt="ReelIntel" style={{ height: 32, width: 'auto', display: 'block' }} />
        <a href={TESTFLIGHT_URL} target="_blank" rel="noreferrer"
          style={{
            background: T.brass, color: T.oceanDeep, padding: '9px 16px',
            borderRadius: 8, fontSize: 13, fontWeight: 800, letterSpacing: 1,
            textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          Join the Beta <ArrowRight size={14} />
        </a>
      </header>

      <section style={{
        maxWidth: 1120, margin: '0 auto', padding: '56px 24px 32px',
        display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: T.brass, fontWeight: 800 }}>
            BUILT FOR THE GULF
          </div>
          <h1 style={{
            fontSize: 56, fontWeight: 900, color: T.ink, letterSpacing: -0.5,
            lineHeight: 1.02, margin: '10px 0 0',
          }}>
            Know your catch.<br />Build your fishing map.
          </h1>
          <p style={{ fontSize: 17, color: T.inkSoft, lineHeight: 1.55, marginTop: 18, maxWidth: 520 }}>
            Snap a photo. ReelIntel identifies the species, checks the current
            regulations for your waters, and logs the catch with your GPS and
            conditions. Every trip makes your map smarter.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
            <a href={TESTFLIGHT_URL} target="_blank" rel="noreferrer"
              style={{
                background: T.brass, color: T.oceanDeep, padding: '14px 22px',
                borderRadius: 10, fontSize: 14, fontWeight: 800, letterSpacing: 1,
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
              Join TestFlight <ArrowRight size={16} />
            </a>
            <a href="#features"
              style={{
                background: 'transparent', color: T.brass, padding: '14px 22px',
                borderRadius: 10, border: `1.5px solid ${T.brass}`,
                fontSize: 14, fontWeight: 800, letterSpacing: 1,
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
              See how it works
            </a>
          </div>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 260, textAlign: 'center' }}>
          <img src={BRAND_LOGO} alt="" style={{ maxWidth: '100%', maxHeight: 460, objectFit: 'contain' }} />
        </div>
      </section>

      <section id="features" style={{
        maxWidth: 1120, margin: '0 auto', padding: '48px 24px 32px',
        display: 'flex', gap: 20, flexWrap: 'wrap',
      }}>
        <Feature
          icon={Camera}
          title="Identify"
          body="Photo-first capture with on-device species ID. Works fully offline — no signal required at the boat ramp." />
        <Feature
          icon={ShieldCheck}
          title="Check the rules"
          body="Season, size, and bag limits for federal and state waters across the Gulf. Legality banner on every catch." />
        <Feature
          icon={BookOpen}
          title="Log & learn"
          body="GPS, weather, sun and moon logged with every catch. Patterns screen shows what's biting when." />
      </section>

      <section style={{
        maxWidth: 1120, margin: '0 auto', padding: '32px 24px 64px',
      }}>
        <div style={{
          background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 20,
          padding: '30px 26px', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <Cloud size={40} color={T.brass} strokeWidth={2} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>Sync across your devices</div>
            <div style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.55, marginTop: 4 }}>
              Sign in with your email — no password. Your catches, PBs, and photos land on every device you use.
            </div>
          </div>
          <a href={TESTFLIGHT_URL} target="_blank" rel="noreferrer"
            style={{
              background: T.brass, color: T.oceanDeep, padding: '12px 20px',
              borderRadius: 10, fontSize: 13, fontWeight: 800, letterSpacing: 1,
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            Get the app <ArrowRight size={14} />
          </a>
        </div>
      </section>

      <footer style={{
        borderTop: `1px solid ${T.cardEdge}`, padding: '22px 24px',
        color: T.inkMute, fontSize: 12,
        maxWidth: 1120, margin: '0 auto',
        display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div>© {new Date().getFullYear()} ReelIntel</div>
        <div style={{ display: 'flex', gap: 18 }}>
          <a href="mailto:hello@reelintel.ai" style={{ color: T.inkMute, textDecoration: 'none' }}>Contact</a>
          <a href="/privacy" style={{ color: T.inkMute, textDecoration: 'none' }}>Privacy</a>
        </div>
      </footer>
    </div>
  );
}
