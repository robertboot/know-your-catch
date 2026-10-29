/* Legal tab — edit privacy / terms / support docs served by the
   static reelintel.ai/{slug} pages. Body is raw HTML; the static
   page injects it verbatim into its <article> container. Ships
   with a bundled default so if the DB row is missing (fresh
   deploy, table not migrated), the page still renders — the
   admin's edits override the bundled copy once saved. */

import React, { useEffect, useState } from 'react';
import { T } from '../theme.js';
import {
  Card, GhostButton, PrimaryButton, H1, SectionLabel, inputStyle,
} from '../components.jsx';
import {
  fetchLegalDoc, upsertLegalDoc, listLegalDocs,
} from '../legal-docs-store.js';
import { relativeTime } from '../helpers.js';

const DOC_SLOTS = [
  { slug: 'privacy', title: 'Privacy Policy', url: '/privacy',
    hint: 'Served at reelintel.ai/privacy. This is the URL the App Store submission points to.' },
  // Future slots — add rows here and the tab picks them up automatically.
  // { slug: 'terms',   title: 'Terms of Service', url: '/terms',   hint: '…' },
  // { slug: 'support', title: 'Support',          url: '/support', hint: '…' },
];

export default function LegalTab() {
  const [activeSlug, setActiveSlug] = useState(DOC_SLOTS[0].slug);
  const [docs, setDocs] = useState({});   // { slug: {title, body_html, updated_at, updated_by} }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState({ title: '', body_html: '' });
  const [dirty, setDirty] = useState(false);

  const active = DOC_SLOTS.find(s => s.slug === activeSlug) || DOC_SLOTS[0];

  const refresh = async () => {
    setLoading(true); setError('');
    const r = await listLegalDocs();
    setLoading(false);
    if (!r.ok) { setError(r.error || 'load failed'); return; }
    const map = {};
    for (const row of r.rows) map[row.slug] = row;
    setDocs(map);
    seedDraftFor(activeSlug, map);
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const seedDraftFor = (slug, map = docs) => {
    const row = map[slug];
    if (row) {
      setDraft({ title: row.title, body_html: row.body_html });
    } else {
      // No row yet — pre-fill with the shipping default so admin
      // can edit from a real starting point instead of a blank slate.
      const slot = DOC_SLOTS.find(s => s.slug === slug);
      setDraft({ title: slot?.title || slug, body_html: DEFAULT_BODIES[slug] || '' });
    }
    setDirty(false);
    setStatus('');
  };

  const switchDoc = (slug) => {
    if (dirty && !window.confirm('Discard unsaved changes to the current doc?')) return;
    setActiveSlug(slug);
    seedDraftFor(slug);
  };

  const doSave = async () => {
    if (!draft.title.trim() || !draft.body_html.trim()) {
      setError('Title and body are both required.');
      return;
    }
    setSaving(true); setError(''); setStatus('');
    const sessionEmail = (typeof window !== 'undefined' && window.__kycAdminEmail) || null;
    const r = await upsertLegalDoc({
      slug: activeSlug,
      title: draft.title,
      body_html: draft.body_html,
    }, { sessionEmail });
    setSaving(false);
    if (!r.ok) { setError(r.error || 'save failed'); return; }
    setStatus('Saved.');
    setDirty(false);
    refresh();
  };

  const current = docs[activeSlug];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <H1 size={20} style={{ margin: 0 }}>Legal</H1>
        <div style={{ fontSize: 11, color: T.inkMute }}>
          Edit the docs served by the static reelintel.ai/{'{'}slug{'}'} pages.
        </div>
      </div>

      {/* Doc selector — only one slot today (privacy), but wired
          for terms / support to slot in without a UI change. */}
      {DOC_SLOTS.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DOC_SLOTS.map(s => {
            const isActive = s.slug === activeSlug;
            return (
              <button key={s.slug} onClick={() => switchDoc(s.slug)} style={{
                background: isActive ? T.brass : 'transparent',
                color: isActive ? T.oceanDeep : T.inkSoft,
                border: `1px solid ${isActive ? T.brass : T.cardEdge}`,
                padding: '6px 12px', borderRadius: 6,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                {s.title}
              </button>
            );
          })}
        </div>
      )}

      <Card style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
          {active.hint}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                      fontSize: 11, color: T.inkMute }}>
          <a href={active.url} target="_blank" rel="noopener noreferrer"
             style={{ color: T.brass, fontWeight: 700 }}>
            Open live page ↗
          </a>
          {current ? (
            <span>
              Last saved {relativeTime(current.updated_at)}
              {current.updated_by ? ` by ${current.updated_by}` : ''}
            </span>
          ) : (
            <span style={{ color: T.warn, fontWeight: 700 }}>
              No saved row yet — the live page is serving the bundled default.
            </span>
          )}
        </div>
      </Card>

      {loading && (
        <Card style={{ padding: 12, color: T.inkMute, fontSize: 12, textAlign: 'center' }}>
          Loading…
        </Card>
      )}

      {error && (
        <div role="alert" style={{
          padding: 10, background: T.closedBg, color: T.closed,
          borderRadius: 8, fontSize: 12, fontWeight: 700,
        }}>
          {error}
        </div>
      )}

      {!loading && (
        <>
          <div style={{ display: 'grid', gap: 6 }}>
            <SectionLabel>Title</SectionLabel>
            <input
              value={draft.title}
              onChange={(e) => { setDraft(d => ({ ...d, title: e.target.value })); setDirty(true); }}
              style={inputStyle}
              placeholder="Privacy Policy"
            />
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <SectionLabel>Body (HTML)</SectionLabel>
              <div style={{ fontSize: 10, color: T.inkMute, flex: 1 }}>
                Paste HTML fragments. Live page injects this into a styled
                container — safe tags: {'<h2>'} {'<p>'} {'<ul>'} {'<li>'} {'<a>'} {'<strong>'} {'<em>'}.
                No {'<script>'} — the static page renders in-page and any
                script tag would break the CSP.
              </div>
            </div>
            <textarea
              value={draft.body_html}
              onChange={(e) => { setDraft(d => ({ ...d, body_html: e.target.value })); setDirty(true); }}
              rows={22}
              spellCheck={true}
              style={{
                ...inputStyle,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12, lineHeight: 1.55,
                minHeight: 440,
                resize: 'vertical',
              }}
              placeholder="<h2>1. Who we are…</h2>"
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <PrimaryButton onClick={doSave} disabled={saving || !dirty}
                           style={{ padding: '10px 16px' }}>
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </PrimaryButton>
            <GhostButton
              onClick={() => seedDraftFor(activeSlug)}
              disabled={!dirty}
              style={{ padding: '10px 14px' }}>
              Revert edits
            </GhostButton>
            {status && (
              <span style={{ fontSize: 12, color: T.open, fontWeight: 700 }}>
                {status}
              </span>
            )}
            {dirty && (
              <span style={{ fontSize: 11, color: T.warn, fontWeight: 700 }}>
                Unsaved changes
              </span>
            )}
          </div>

          <Card style={{ padding: 14, marginTop: 8 }}>
            <SectionLabel style={{ marginBottom: 8 }}>Preview</SectionLabel>
            <div
              style={{
                background: '#fff', color: '#111', padding: 20,
                borderRadius: 8, maxHeight: 360, overflowY: 'auto',
                fontSize: 14, lineHeight: 1.5,
              }}
              // Preview only — HTML source is authored by the admin and
              // stored in Supabase behind an email-gated RLS write policy.
              // Same trust model as any CMS body field.
              dangerouslySetInnerHTML={{ __html: draft.body_html || '<em>Empty</em>' }}
            />
          </Card>
        </>
      )}
    </div>
  );
}


/* Shipping defaults — matches what's in public/privacy.html so a
   fresh install (no Supabase row yet) shows the same content the
   /privacy page already ships with, and the admin can edit from
   there instead of a blank textarea. */
const DEFAULT_BODIES = {
  privacy: `
<h2>1. Who we are</h2>
<p>ReelIntel is a fishing app for the Gulf of Mexico built by ReelIntel LLC (&ldquo;ReelIntel,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;).</p>
<p>Contact: <a href="mailto:support@reelintel.ai">support@reelintel.ai</a></p>

<h2>2. What we collect</h2>
<ul>
  <li><strong>Account.</strong> Email address, when you create an account.</li>
  <li><strong>Catches.</strong> Species, date, location (at the precision you choose &mdash; exact, 1&nbsp;km grid, or 10&nbsp;km grid), length, weight, notes, environmental context (moon, tide, weather), and any photos you attach.</li>
  <li><strong>Species suggestions.</strong> Text and optional photos you submit when you propose a new species.</li>
  <li><strong>Device / diagnostics.</strong> Crash logs and non-identifying usage counters (screens opened, feature taps) so we can fix bugs and improve the app.</li>
</ul>
<p>We do not collect contacts, health data, browsing history, or advertising identifiers.</p>

<h2>3. What we don&rsquo;t do</h2>
<ul>
  <li>We do not sell your data.</li>
  <li>We do not run third-party advertising.</li>
  <li>We do not track you across other apps or websites.</li>
</ul>

<h2>4. Where your data lives</h2>
<p>Your catches sync to our backend on Supabase (US region) so you can restore them on a new device. Photos are stored in encrypted object storage. When you&rsquo;re signed out or offline, everything stays on your device.</p>

<h2>5. Fish ID</h2>
<p>Species identification runs entirely on your device using a small on-device model. Photos submitted through the Fish ID flow are not sent anywhere unless you explicitly submit a correction, in which case the photo is uploaded to help improve the model.</p>

<h2>6. Research contributions</h2>
<p>If you opt in, anonymized catch metadata (species, date, jurisdiction, environmental context &mdash; no email, no exact coordinates without your explicit consent) may be shared with fisheries science partners such as NOAA. You can opt out at any time in Settings.</p>

<h2>7. Children</h2>
<p>ReelIntel is not directed at children under 13 and we do not knowingly collect data from them.</p>

<h2>8. Your rights</h2>
<p>Email <a href="mailto:support@reelintel.ai">support@reelintel.ai</a> to export a copy of your data or to delete your account and everything associated with it. We respond within 30 days.</p>

<h2>9. Changes</h2>
<p>When we materially change this policy, we bump the &ldquo;Last updated&rdquo; date above and surface the change in the app.</p>
`.trim(),
};
