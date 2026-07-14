/* Admin Home Dashboard
   -------------------------------------------------------------
   Single-glance status page: what's missing, what needs review,
   what the app looks like right now. Every tile fetches from an
   existing store or a direct HEAD count against Supabase — no new
   backend surface, just aggregation.

   Sections (top → bottom):
     1. Health strip  — model published, pending Colab bundles,
                        last successful AI draft.
     2. Action queue  — every "someone should look at this" number
                        with a jump-to-tab CTA.
     3. Species       — coverage gaps (photo, scientific name,
                        category, tier-2 fields).
     4. Regulations   — jurisdiction × status grid + oldest verified.
     5. Training      — per-species coverage buckets, total pending.
     6. Categories    — species-per-category with orphan flag.
     7. Users         — signup + catch counts (gated on admin RLS).
     8. Recent        — last 10 regs verified, training approvals,
                        species edits, user suggestions.

   All tiles are best-effort: any single-fetch failure is surfaced
   in that section's card, the rest of the dashboard still loads.
   The refresh button re-runs every fetch in parallel. */

import React, { useState, useEffect } from 'react';
import { T } from '../theme.js';
import { SPECIES, JURISDICTIONS } from '../data.js';
import { client } from '../supabase-client.js';
import {
  refreshSpecies, speciesPhotoOverrideAll,
} from '../species-store.js';
import {
  getCategories, refreshCategories,
} from '../categories-store.js';
import {
  adminListRegulations, adminCountStalable, regulationAge,
} from '../regulations-store.js';
import {
  countsBySpecies, countMyPendingOwnerUploads, classifyCoverage,
  MIN_TRAIN_THRESHOLD, ADEQUATE_THRESHOLD, TARGET_COVERAGE,
} from '../training-store.js';
import { listPendingBundles } from '../training-exports-store.js';
import { getProductionModel, publishedManifestUrl } from '../model-store.js';
import { listSuggestions } from '../species-suggestions-store.js';
import { Card, GhostButton, H1, SectionLabel } from '../components.jsx';

/* ============================================================
   Data hook — parallel fan-out of every dashboard fetch.
   Failures land per-section in `state.errors[section]` so a
   broken tile doesn't take the whole page down.
   ============================================================ */
function useDashboardData() {
  const [state, setState] = useState({
    loading: true,
    refreshedAt: null,
    errors: {},
    health: null,
    queue: null,
    species: null,
    regsMatrix: null,
    training: null,
    categories: null,
    users: null,
    recent: null,
  });

  const refresh = async () => {
    setState(s => ({ ...s, loading: true, errors: {} }));

    // Fire every fetch in parallel — the dashboard is one-shot on
    // mount + on the Refresh button, so we optimize for wall-clock.
    const [
      healthRes, queueRes, speciesRes, regsMatrixRes,
      trainingRes, categoriesRes, usersRes, recentRes,
    ] = await Promise.allSettled([
      fetchHealth(),
      fetchActionQueue(),
      fetchSpeciesCoverage(),
      fetchRegsMatrix(),
      fetchTrainingCoverage(),
      fetchCategoriesTable(),
      fetchUsers(),
      fetchRecentActivity(),
    ]);

    const pick = (res) => {
      if (res.status === 'fulfilled') return { value: res.value, err: null };
      return { value: null, err: res.reason?.message || String(res.reason) };
    };

    const health     = pick(healthRes);
    const queue      = pick(queueRes);
    const species    = pick(speciesRes);
    const regsMatrix = pick(regsMatrixRes);
    const training   = pick(trainingRes);
    const categories = pick(categoriesRes);
    const users      = pick(usersRes);
    const recent     = pick(recentRes);

    setState({
      loading: false,
      refreshedAt: new Date().toISOString(),
      errors: {
        health: health.err, queue: queue.err, species: species.err,
        regsMatrix: regsMatrix.err, training: training.err,
        categories: categories.err, users: users.err, recent: recent.err,
      },
      health: health.value,
      queue: queue.value,
      species: species.value,
      regsMatrix: regsMatrix.value,
      training: training.value,
      categories: categories.value,
      users: users.value,
      recent: recent.value,
    });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, refresh };
}

/* ============================================================
   Individual fetch functions.
   ============================================================ */

async function fetchHealth() {
  const [prod, bundles, lastAi] = await Promise.all([
    getProductionModel(),
    listPendingBundles().catch(() => ({ ok: false, rows: [] })),
    (async () => {
      const c = client();
      if (!c) return null;
      const { data } = await c.from('regulations')
        .select('drafted_at, species_id, jurisdiction_id')
        .eq('drafted_by', 'ai')
        .order('drafted_at', { ascending: false })
        .limit(1);
      return data?.[0] || null;
    })(),
  ]);

  const modelClasses = prod?.row?.labels_json?.labels?.length || 0;
  const modelVersion = prod?.row?.version_name || null;

  // Try to read the published manifest for the wall-clock publish
  // time. Cheap: one anon fetch against the public bucket.
  let publishedAt = null;
  try {
    const url = publishedManifestUrl();
    if (url) {
      // Bust caches so we don't show a stale manifest after a
      // re-promote in the same session.
      const resp = await fetch(url + '?_=' + Date.now(), { cache: 'no-store' });
      if (resp.ok) {
        const j = await resp.json();
        publishedAt = j?.published_at || null;
      }
    }
  } catch { /* best-effort */ }

  return {
    model: prod?.row ? {
      version: modelVersion,
      classCount: modelClasses,
      publishedAt,
      warning: prod?.publishWarning || null,
    } : null,
    pendingBundles: bundles.ok ? bundles.rows.length : 0,
    lastAiDraft: lastAi?.drafted_at || null,
    lastAiDraftSpecies: lastAi?.species_id || null,
  };
}

async function fetchActionQueue() {
  const c = client();
  if (!c) throw new Error('supabase not configured');

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [
    suggestionsPending,
    trainingPending,
    trainingRejected,
    ownerBacklog,
    regsDraftsOld,
    announcementsAll,
  ] = await Promise.all([
    listSuggestions({ status: 'pending', limit: 500 }).then(r => r.ok ? r.rows.length : 0),
    c.from('training_images')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(r => r.count || 0),
    c.from('training_images')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'rejected')
      .then(r => r.count || 0),
    countMyPendingOwnerUploads().then(r => r.ok ? r.count : 0),
    c.from('regulations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft')
      .lt('drafted_at', sevenDaysAgo)
      .then(r => r.count || 0),
    // announcements table may not exist in all deployments — swallow
    // an error and treat as 0.
    c.from('announcements')
      .select('id, starts_at, ends_at')
      .then(r => r.data || [])
      .catch(() => []),
  ]);

  // Stale verified — sum HEAD counts across all jurisdictions.
  const staleCounts = await Promise.all(
    JURISDICTIONS.map(j => adminCountStalable({ jurisdictionId: j.id })
      .then(r => r.ok ? r.count : 0))
  );
  const regsStale = staleCounts.reduce((a, b) => a + b, 0);

  const nowIso = new Date().toISOString();
  const announcementsActive = announcementsAll.filter(a => {
    const starts = a.starts_at || null;
    const ends   = a.ends_at   || null;
    return (!starts || starts <= nowIso) && (!ends || ends >= nowIso);
  }).length;

  return {
    suggestionsPending,
    trainingPending,
    trainingRejected,
    ownerBacklog,
    regsDraftsOld,
    regsStale,
    announcementsActive,
  };
}

async function fetchSpeciesCoverage() {
  await refreshSpecies();
  const all = SPECIES;
  const active = all.filter(s => s.active !== false);

  const missing = { photo: [], scientific: [], category: [], tier2: [], altNames: [] };
  for (const sp of active) {
    // Photo: prefer live overrides, then bundled sp.photos.
    const overrides = speciesPhotoOverrideAll(sp.id) || [];
    const bundledPhotos = Array.isArray(sp.photos) ? sp.photos : [];
    if (overrides.length === 0 && bundledPhotos.length === 0) missing.photo.push(sp);
    if (!sp.scientific)                                       missing.scientific.push(sp);
    if (!sp.category)                                         missing.category.push(sp);
    // Tier-2 = at least typical length AND edibility populated.
    // Both come from the species-tier-fields migration; blank means
    // the researcher pass hasn't happened for this row yet.
    if (sp.typical_length_in == null || !sp.edibility)        missing.tier2.push(sp);
    if (!sp.alt_names || (Array.isArray(sp.alt_names) && sp.alt_names.length === 0))
      missing.altNames.push(sp);
  }

  return {
    total: all.length,
    active: active.length,
    inactive: all.length - active.length,
    missing,
  };
}

async function fetchRegsMatrix() {
  // Cheap: 6 parallel per-jurisdiction fetches, then per-jurisdiction
  // rollup. Total wall-clock is one round-trip.
  const active = SPECIES.filter(s => s.active !== false);
  const totalSpecies = active.length;

  const rows = await Promise.all(
    JURISDICTIONS.map(async (j) => {
      const r = await adminListRegulations({ jurisdictionId: j.id });
      if (!r.ok) return { jur: j, error: r.error || 'load failed' };
      const byStatus = { verified: 0, draft: 0, stale: 0, disputed: 0 };
      let agingVerified = 0; // verified but > 365 days
      for (const row of r.rows) {
        byStatus[row.status] = (byStatus[row.status] || 0) + 1;
        if (row.status === 'verified') {
          const age = regulationAge(row);
          if (age && age.tier === 'stale') agingVerified += 1;
        }
      }
      const withRow = r.rows.length;
      const none = Math.max(0, totalSpecies - withRow);
      return { jur: j, counts: { ...byStatus, none }, agingVerified };
    })
  );

  return { totalSpecies, jurisdictions: rows };
}

async function fetchTrainingCoverage() {
  const r = await countsBySpecies();
  if (!r.ok) throw new Error(r.error || 'training counts failed');

  const active = SPECIES.filter(s => s.active !== false);
  const buckets = { excluded: [], thin: [], ok: [], good: [] };
  let totalVerified = 0, totalPending = 0, totalRejected = 0;

  for (const sp of active) {
    const c = r.counts[sp.id] || { verified: 0, pending: 0, rejected: 0 };
    totalVerified += c.verified || 0;
    totalPending  += c.pending  || 0;
    totalRejected += c.rejected || 0;
    const tier = classifyCoverage(c.verified || 0);
    buckets[tier].push({ sp, verified: c.verified || 0, pending: c.pending || 0, rejected: c.rejected || 0 });
  }

  // Sort within each bucket by verified ascending so the "closest to
  // graduating" species float to the top of their bucket.
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => a.verified - b.verified);
  }

  return {
    totals: {
      verified: totalVerified,
      pending: totalPending,
      rejected: totalRejected,
      speciesCount: active.length,
    },
    thresholds: { min: MIN_TRAIN_THRESHOLD, ok: ADEQUATE_THRESHOLD, target: TARGET_COVERAGE },
    buckets,
  };
}

async function fetchCategoriesTable() {
  await refreshCategories();
  const cats = getCategories();
  const active = SPECIES.filter(s => s.active !== false);
  const bySlot = new Map(cats.map(c => [c.id, { ...c, count: 0 }]));
  let orphans = 0;
  for (const sp of active) {
    if (!sp.category) { orphans += 1; continue; }
    const slot = bySlot.get(sp.category);
    if (slot) slot.count += 1;
    else orphans += 1;
  }
  return {
    rows: Array.from(bySlot.values()).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    orphans,
  };
}

async function fetchUsers() {
  const c = client();
  if (!c) throw new Error('supabase not configured');

  const sevenDaysAgo  = new Date(Date.now() -  7 * 86400_000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  // All queries are HEAD counts. If admin RLS bypass isn't in place
  // yet (supabase/admin-read-anglers-schema.sql not applied), these
  // return 0 with no error — we flag `gated: true` when the numbers
  // look implausible (zero anglers but at least one existing row we
  // can see from the current session).
  const [angTotal, ang7, ang30, catTotal, cat7, cat30] = await Promise.all([
    c.from('anglers').select('id', { count: 'exact', head: true }).then(r => r.count ?? 0),
    c.from('anglers').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo).then(r => r.count ?? 0),
    c.from('anglers').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo).then(r => r.count ?? 0),
    c.from('catches').select('id', { count: 'exact', head: true }).then(r => r.count ?? 0),
    c.from('catches').select('id', { count: 'exact', head: true }).gte('inserted_at', sevenDaysAgo).then(r => r.count ?? 0),
    c.from('catches').select('id', { count: 'exact', head: true }).gte('inserted_at', thirtyDaysAgo).then(r => r.count ?? 0),
  ]);

  // Photo opt-in rate — how many catches have a paired photo row.
  const catPhotoTotal = await c.from('catch_photos')
    .select('id', { count: 'exact', head: true })
    .then(r => r.count ?? 0);

  // Simple gate heuristic: totals are 0 across the board. Almost
  // certainly RLS is blocking the read (the admin's OWN rows would
  // still surface if only the researcher policy were missing).
  const gated = angTotal === 0 && catTotal === 0;

  return {
    gated,
    anglers: { total: angTotal, last7: ang7,  last30: ang30 },
    catches: { total: catTotal, last7: cat7,  last30: cat30, withPhoto: catPhotoTotal },
  };
}

async function fetchRecentActivity() {
  const c = client();
  if (!c) throw new Error('supabase not configured');

  const [regs, training, species, sugg] = await Promise.all([
    c.from('regulations')
      .select('id, species_id, jurisdiction_id, verified_at, verified_by, source_url')
      .eq('status', 'verified')
      .order('verified_at', { ascending: false })
      .limit(10)
      .then(r => r.data || []),
    c.from('training_images')
      .select('id, species_id, status, reviewed_at, reviewed_by, rejection_reason')
      .not('reviewed_at', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(10)
      .then(r => r.data || []),
    c.from('species')
      .select('id, common_name, updated_at, updated_by')
      .not('updated_at', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(10)
      .then(r => r.data || []),
    c.from('species_suggestions')
      .select('id, common_name, status, submitted_at')
      .order('submitted_at', { ascending: false })
      .limit(10)
      .then(r => r.data || []),
  ]);

  return {
    verifiedRegs: regs,
    trainingReviews: training,
    speciesEdits: species,
    suggestions: sugg,
  };
}

/* ============================================================
   Rendering
   ============================================================ */

export default function HomeDashboard({ onGoTab }) {
  const { state, refresh } = useDashboardData();

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <DashboardHeader
        loading={state.loading}
        refreshedAt={state.refreshedAt}
        onRefresh={refresh}
      />

      <HealthStrip data={state.health} err={state.errors.health} loading={state.loading} />

      <ActionQueue data={state.queue} err={state.errors.queue}
                   loading={state.loading} onGoTab={onGoTab} />

      <SpeciesCoveragePanel data={state.species} err={state.errors.species}
                            loading={state.loading} onGoTab={onGoTab} />

      <RegulationsMatrixPanel data={state.regsMatrix} err={state.errors.regsMatrix}
                              loading={state.loading} onGoTab={onGoTab} />

      <TrainingCoveragePanel data={state.training} err={state.errors.training}
                             loading={state.loading} onGoTab={onGoTab} />

      <CategoriesPanel data={state.categories} err={state.errors.categories}
                       loading={state.loading} onGoTab={onGoTab} />

      <UsersPanel data={state.users} err={state.errors.users} loading={state.loading} />

      <RecentActivityPanel data={state.recent} err={state.errors.recent} loading={state.loading} />
    </div>
  );
}

function DashboardHeader({ loading, refreshedAt, onRefresh }) {
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
      padding: '2px 4px',
    }}>
      <H1 size={20} style={{ margin: 0 }}>Dashboard</H1>
      <div style={{ fontSize: 11, color: T.inkMute, flex: 1 }}>
        {refreshedAt
          ? `Refreshed ${relativeTime(refreshedAt)}`
          : 'Loading…'}
      </div>
      <GhostButton onClick={onRefresh} disabled={loading} style={{ padding: '8px 14px' }}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </GhostButton>
    </div>
  );
}

/* ---------- Section helper ---------- */
function Section({ title, subtitle, children, right }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <SectionLabel style={{ fontSize: 13, letterSpacing: 1.6, color: T.brass }}>
          {title}
        </SectionLabel>
        {subtitle && (
          <div style={{ fontSize: 11, color: T.inkMute, flex: 1 }}>{subtitle}</div>
        )}
        {right}
      </div>
      {children}
    </div>
  );
}

function ErrorLine({ err }) {
  if (!err) return null;
  return (
    <div role="alert" style={{
      padding: '8px 10px', background: T.closedBg, color: T.closed,
      borderRadius: 8, fontSize: 11, fontWeight: 700,
    }}>
      {err}
    </div>
  );
}

function LoadingLine() {
  return (
    <div style={{ padding: 12, background: T.parchmentDeep, borderRadius: 8,
                  color: T.inkMute, fontSize: 12, textAlign: 'center' }}>
      Loading…
    </div>
  );
}

/* ---------- Health strip ---------- */
function HealthStrip({ data, err, loading }) {
  return (
    <Section title="Health"
             subtitle="Model, AI pipeline, and pending bundle status.">
      {err && <ErrorLine err={err} />}
      {loading && !data && <LoadingLine />}
      {data && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 8,
        }}>
          <Tile
            label="Model published"
            value={data.model ? data.model.version || '—' : 'NOT PUBLISHED'}
            tone={data.model ? 'ok' : 'warn'}
            hint={data.model
              ? `${data.model.classCount} classes${data.model.publishedAt
                  ? ' · ' + relativeTime(data.model.publishedAt) : ''}`
              : 'Import a Colab bundle and promote it'}
          />
          <Tile
            label="Pending Colab bundles"
            value={data.pendingBundles || 0}
            tone={data.pendingBundles > 0 ? 'warn' : 'ok'}
            hint={data.pendingBundles > 0 ? 'Import from Training → Models' : 'Nothing waiting'}
          />
          <Tile
            label="Last AI regulation draft"
            value={data.lastAiDraft ? relativeTime(data.lastAiDraft) : '—'}
            tone={data.lastAiDraft ? 'neutral' : 'warn'}
            hint={data.lastAiDraftSpecies ? `${data.lastAiDraftSpecies}` : 'No AI drafts recorded'}
          />
        </div>
      )}
    </Section>
  );
}

/* ---------- Action queue ---------- */
function ActionQueue({ data, err, loading, onGoTab }) {
  return (
    <Section title="Action queue"
             subtitle="Everything with a decision waiting on you, ordered by urgency.">
      {err && <ErrorLine err={err} />}
      {loading && !data && <LoadingLine />}
      {data && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 8,
        }}>
          <ActionTile label="Species suggestions"
                      count={data.suggestionsPending}
                      hint="Users submitted new species awaiting approval"
                      ctaLabel="Review"
                      urgent
                      onClick={() => onGoTab?.('species')} />
          <ActionTile label="Training review backlog"
                      count={data.trainingPending}
                      hint="Photos submitted but not yet approved/rejected"
                      ctaLabel="Review"
                      urgent={data.trainingPending > 0}
                      onClick={() => onGoTab?.('training')} />
          <ActionTile label="Rejected photos"
                      count={data.trainingRejected}
                      hint="Some may be recoverable via crop-to-recover"
                      ctaLabel="Open Rejected"
                      onClick={() => onGoTab?.('training')} />
          <ActionTile label="My owner-upload backlog"
                      count={data.ownerBacklog}
                      hint="Uploads pending under your admin email"
                      ctaLabel="Verify mine"
                      urgent={data.ownerBacklog > 0}
                      onClick={() => onGoTab?.('training')} />
          <ActionTile label="Regs drafts > 7d"
                      count={data.regsDraftsOld}
                      hint="AI drafts that haven't been verified"
                      ctaLabel="Verify"
                      urgent={data.regsDraftsOld > 0}
                      onClick={() => onGoTab?.('regulations')} />
          <ActionTile label="Regs verified > 1yr"
                      count={data.regsStale}
                      hint="Annual refresh candidates across all jurisdictions"
                      ctaLabel="Refresh"
                      urgent={data.regsStale > 0}
                      onClick={() => onGoTab?.('regulations')} />
          <ActionTile label="Active announcements"
                      count={data.announcementsActive}
                      hint="Currently visible in the app right now"
                      ctaLabel="Manage"
                      onClick={() => onGoTab?.('notifications')} />
        </div>
      )}
    </Section>
  );
}

/* ---------- Species coverage ---------- */
function SpeciesCoveragePanel({ data, err, loading, onGoTab }) {
  return (
    <Section title="Species coverage"
             subtitle="Gaps in the species table. Fill these before launch.">
      {err && <ErrorLine err={err} />}
      {loading && !data && <LoadingLine />}
      {data && (
        <Card style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <BigStat label="Active species" value={data.active} />
            <BigStat label="Inactive" value={data.inactive} muted />
            <BigStat label="Total" value={data.total} muted />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <CoverageBar label="Has photo"
                         missing={data.missing.photo.length}
                         total={data.active}
                         onClick={() => onGoTab?.('species')}
                         examples={data.missing.photo.slice(0, 6).map(s => s.commonName)} />
            <CoverageBar label="Has scientific name"
                         missing={data.missing.scientific.length}
                         total={data.active}
                         onClick={() => onGoTab?.('species')}
                         examples={data.missing.scientific.slice(0, 6).map(s => s.commonName)} />
            <CoverageBar label="Has category"
                         missing={data.missing.category.length}
                         total={data.active}
                         onClick={() => onGoTab?.('species')}
                         examples={data.missing.category.slice(0, 6).map(s => s.commonName)} />
            <CoverageBar label="Has tier-2 fields (size + edibility)"
                         missing={data.missing.tier2.length}
                         total={data.active}
                         onClick={() => onGoTab?.('species')}
                         examples={data.missing.tier2.slice(0, 6).map(s => s.commonName)} />
            <CoverageBar label="Has alt names"
                         missing={data.missing.altNames.length}
                         total={data.active}
                         onClick={() => onGoTab?.('species')}
                         examples={data.missing.altNames.slice(0, 6).map(s => s.commonName)} />
          </div>
        </Card>
      )}
    </Section>
  );
}

/* ---------- Regulations matrix ---------- */
function RegulationsMatrixPanel({ data, err, loading, onGoTab }) {
  return (
    <Section title="Regulations"
             subtitle="Jurisdiction × status. Verified is the only thing anglers see.">
      {err && <ErrorLine err={err} />}
      {loading && !data && <LoadingLine />}
      {data && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: 12, color: T.ink, minWidth: 640,
            }}>
              <thead>
                <tr style={{ background: T.parchmentDeep }}>
                  <Th>Jurisdiction</Th>
                  <Th align="right">Verified</Th>
                  <Th align="right">Draft</Th>
                  <Th align="right">Stale</Th>
                  <Th align="right">Disputed</Th>
                  <Th align="right">No row</Th>
                  <Th align="right">Aging verified &gt; 1yr</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody>
                {data.jurisdictions.map(j => (
                  <tr key={j.jur.id} style={{ borderTop: `1px solid ${T.cardEdge}` }}>
                    <Td>
                      <div style={{ fontWeight: 700 }}>{j.jur.name}</div>
                      <div style={{ fontSize: 10, color: T.inkMute }}>{j.jur.agency}</div>
                    </Td>
                    {j.error
                      ? <Td colSpan={7} style={{ color: T.closed }}>load failed: {j.error}</Td>
                      : (<>
                          <Td align="right" tone="ok">{j.counts.verified}</Td>
                          <Td align="right" tone="warn">{j.counts.draft}</Td>
                          <Td align="right" tone="closed">{j.counts.stale}</Td>
                          <Td align="right" tone="closed">{j.counts.disputed}</Td>
                          <Td align="right" muted>{j.counts.none}</Td>
                          <Td align="right" tone="warn">{j.agingVerified}</Td>
                          <Td align="right">
                            <GhostButton
                              onClick={() => onGoTab?.('regulations')}
                              style={{ padding: '4px 8px', fontSize: 10 }}>
                              Open
                            </GhostButton>
                          </Td>
                        </>)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: T.parchmentDeep, borderTop: `2px solid ${T.brass}` }}>
                  <Td style={{ fontWeight: 800 }}>Total species (active)</Td>
                  <Td colSpan={7} style={{ color: T.inkMute }}>
                    {data.totalSpecies} — target is verified in every jurisdiction that
                    regulates the species.
                  </Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </Section>
  );
}

/* ---------- Training coverage ---------- */
function TrainingCoveragePanel({ data, err, loading, onGoTab }) {
  return (
    <Section title="Training coverage"
             subtitle={`Per-species verified counts vs thresholds. ` +
                       `Thin < ${data?.thresholds?.min || 30}, ` +
                       `OK ≥ ${data?.thresholds?.min || 30}, ` +
                       `Good ≥ ${data?.thresholds?.ok || 75}, ` +
                       `Target ${data?.thresholds?.target || 200}.`}>
      {err && <ErrorLine err={err} />}
      {loading && !data && <LoadingLine />}
      {data && (
        <Card style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <BigStat label="Verified photos" value={data.totals.verified} />
            <BigStat label="Pending" value={data.totals.pending} tone={data.totals.pending > 0 ? 'warn' : 'ok'} />
            <BigStat label="Rejected" value={data.totals.rejected} muted />
            <BigStat label="Species tracked" value={data.totals.speciesCount} muted />
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 8,
          }}>
            <BucketCard title="Excluded" tone="closed"
                        rows={data.buckets.excluded}
                        hint="No verified photos" />
            <BucketCard title="Thin" tone="warn"
                        rows={data.buckets.thin}
                        hint={`< ${data.thresholds.min} verified — model will skip`} />
            <BucketCard title="OK" tone="neutral"
                        rows={data.buckets.ok}
                        hint={`${data.thresholds.min}–${data.thresholds.ok - 1} verified`} />
            <BucketCard title="Good" tone="ok"
                        rows={data.buckets.good}
                        hint={`≥ ${data.thresholds.ok} verified`} />
          </div>
          <div>
            <GhostButton onClick={() => onGoTab?.('training')}
                         style={{ padding: '8px 12px', fontSize: 12 }}>
              Open Training tab
            </GhostButton>
          </div>
        </Card>
      )}
    </Section>
  );
}

function BucketCard({ title, tone, rows, hint }) {
  const toneColor = tone === 'ok' ? T.open : tone === 'warn' ? T.brass
                   : tone === 'closed' ? T.closed : T.inkSoft;
  return (
    <div style={{
      background: T.parchmentDeep, borderRadius: 8, padding: 10,
      border: `1px solid ${T.cardEdge}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: toneColor,
                      textTransform: 'uppercase' }}>
          {title}
        </div>
        <div style={{ fontSize: 18, fontWeight: 900, color: T.ink, marginLeft: 'auto' }}>
          {rows.length}
        </div>
      </div>
      <div style={{ fontSize: 10, color: T.inkMute, marginTop: 2 }}>{hint}</div>
      {rows.length > 0 && (
        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none',
                     fontSize: 11, color: T.inkSoft,
                     maxHeight: 140, overflowY: 'auto' }}>
          {rows.slice(0, 12).map(r => (
            <li key={r.sp.id} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '2px 0', gap: 6,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.sp.commonName}
              </span>
              <span style={{ color: T.inkMute, flexShrink: 0 }}>{r.verified}</span>
            </li>
          ))}
          {rows.length > 12 && (
            <li style={{ color: T.inkMute, fontStyle: 'italic', padding: '2px 0' }}>
              +{rows.length - 12} more…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ---------- Categories ---------- */
function CategoriesPanel({ data, err, loading, onGoTab }) {
  return (
    <Section title="Categories"
             subtitle="Species assignments per category. Zero-count = empty tile in the mobile app.">
      {err && <ErrorLine err={err} />}
      {loading && !data && <LoadingLine />}
      {data && (
        <Card style={{ padding: 12, display: 'grid', gap: 10 }}>
          {data.orphans > 0 && (
            <div style={{
              padding: '8px 10px', background: T.warnBg, color: T.warn,
              borderRadius: 8, fontSize: 12, fontWeight: 700,
            }}>
              {data.orphans} active species have no category or point to a missing category.
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 8,
          }}>
            {data.rows.map(c => (
              <div key={c.id} style={{
                background: T.parchmentDeep, borderRadius: 8, padding: '8px 10px',
                border: `1px solid ${c.is_active === false ? T.closed : T.cardEdge}`,
                opacity: c.is_active === false ? 0.6 : 1,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.ink }}>
                  {c.label || c.id}
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: c.count > 0 ? T.brass : T.closed,
                              marginTop: 2 }}>
                  {c.count}
                </div>
                {c.is_active === false && (
                  <div style={{ fontSize: 9, color: T.closed, letterSpacing: 1, fontWeight: 800 }}>
                    HIDDEN
                  </div>
                )}
              </div>
            ))}
          </div>
          <div>
            <GhostButton onClick={() => onGoTab?.('categories')}
                         style={{ padding: '8px 12px', fontSize: 12 }}>
              Open Categories tab
            </GhostButton>
          </div>
        </Card>
      )}
    </Section>
  );
}

/* ---------- Users ---------- */
function UsersPanel({ data, err, loading }) {
  return (
    <Section title="Users"
             subtitle="Angler signups + catch logs. Gated on the admin-read RLS migration.">
      {err && <ErrorLine err={err} />}
      {loading && !data && <LoadingLine />}
      {data && data.gated && (
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, color: T.warn, fontWeight: 700 }}>
            Zero rows returned — the admin RLS bypass on <code>anglers</code>/<code>catches</code>
            isn't in place yet.
          </div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 6 }}>
            Run <code>supabase/admin-read-anglers-schema.sql</code> in the Supabase SQL editor,
            then hit Refresh above.
          </div>
        </Card>
      )}
      {data && !data.gated && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 8,
        }}>
          <Tile label="Anglers total"       value={data.anglers.total} tone="ok" />
          <Tile label="Anglers · last 7 days"  value={data.anglers.last7}  tone={data.anglers.last7 > 0 ? 'ok' : 'neutral'} />
          <Tile label="Anglers · last 30 days" value={data.anglers.last30} tone={data.anglers.last30 > 0 ? 'ok' : 'neutral'} />
          <Tile label="Catches total"       value={data.catches.total} tone="ok" />
          <Tile label="Catches · last 7 days"  value={data.catches.last7}  tone={data.catches.last7 > 0 ? 'ok' : 'neutral'} />
          <Tile label="Catches · last 30 days" value={data.catches.last30} tone={data.catches.last30 > 0 ? 'ok' : 'neutral'} />
          <Tile label="Catches with photo"     value={data.catches.withPhoto}
                hint={data.catches.total > 0
                  ? `${Math.round(100 * data.catches.withPhoto / data.catches.total)}% photo rate`
                  : 'no catches yet'}
                tone="neutral" />
        </div>
      )}
    </Section>
  );
}

/* ---------- Recent activity ---------- */
function RecentActivityPanel({ data, err, loading, onGoTab }) {
  return (
    <Section title="Recent activity"
             subtitle="Latest edits + reviews across every domain.">
      {err && <ErrorLine err={err} />}
      {loading && !data && <LoadingLine />}
      {data && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 8,
        }}>
          <FeedCard title="Regulations verified"
                    empty="No verified regulations yet."
                    onOpen={() => onGoTab?.('regulations')}
                    rows={data.verifiedRegs.map(r => ({
                      key: r.id,
                      primary: r.species_id,
                      secondary: `${r.jurisdiction_id} · by ${r.verified_by || 'unknown'}`,
                      time: r.verified_at,
                    }))} />
          <FeedCard title="Training reviews"
                    empty="No training photos reviewed yet."
                    onOpen={() => onGoTab?.('training')}
                    rows={data.trainingReviews.map(r => ({
                      key: r.id,
                      primary: r.species_id,
                      secondary: `${r.status}${r.rejection_reason ? ' · ' + r.rejection_reason : ''}`,
                      time: r.reviewed_at,
                    }))} />
          <FeedCard title="Species edits"
                    empty="No species edits yet."
                    onOpen={() => onGoTab?.('species')}
                    rows={data.speciesEdits.map(r => ({
                      key: r.id,
                      primary: r.common_name || r.id,
                      secondary: r.updated_by || 'unknown',
                      time: r.updated_at,
                    }))} />
          <FeedCard title="Species suggestions"
                    empty="No user suggestions yet."
                    onOpen={() => onGoTab?.('species')}
                    rows={data.suggestions.map(r => ({
                      key: r.id,
                      primary: r.common_name || r.id,
                      secondary: r.status,
                      time: r.submitted_at,
                    }))} />
        </div>
      )}
    </Section>
  );
}

function FeedCard({ title, rows, empty, onOpen }) {
  return (
    <Card style={{ padding: 10, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: T.ink }}>{title}</div>
        <div style={{ flex: 1 }} />
        {onOpen && (
          <button onClick={onOpen} style={{
            background: 'transparent', border: 'none', color: T.brass,
            cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 700,
          }}>Open</button>
        )}
      </div>
      {rows.length === 0 && (
        <div style={{ fontSize: 11, color: T.inkMute, fontStyle: 'italic' }}>{empty}</div>
      )}
      {rows.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
          {rows.map(r => (
            <li key={r.key} style={{ display: 'grid', gap: 2, padding: '4px 0',
                                     borderTop: `1px solid ${T.cardEdge}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.ink,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.primary}
              </div>
              <div style={{ fontSize: 10, color: T.inkMute,
                            display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.secondary}
                </span>
                <span style={{ flexShrink: 0 }}>{relativeTime(r.time)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ============================================================
   Small shared UI atoms
   ============================================================ */

function Tile({ label, value, hint, tone = 'neutral' }) {
  const toneColor =
    tone === 'ok'      ? T.open   :
    tone === 'warn'    ? T.brass  :
    tone === 'closed'  ? T.closed :
                         T.ink;
  const toneBg =
    tone === 'ok'      ? T.openBg   :
    tone === 'warn'    ? T.warnBg   :
    tone === 'closed'  ? T.closedBg :
                         T.parchmentDeep;
  return (
    <Card style={{ padding: 12, background: toneBg }}>
      <div style={{ fontSize: 10, letterSpacing: 1.4, color: T.inkMute,
                    fontWeight: 800, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color: toneColor, marginTop: 2 }}>
        {value == null ? '—' : value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>{hint}</div>
      )}
    </Card>
  );
}

function ActionTile({ label, count, hint, ctaLabel, onClick, urgent }) {
  const zero = !count || count === 0;
  const tone = zero ? T.open : urgent ? T.brass : T.ink;
  const bg   = zero ? T.openBg : urgent ? T.warnBg : T.parchmentDeep;
  return (
    <Card style={{ padding: 12, background: bg, display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 10, letterSpacing: 1.2, color: T.inkMute,
                    fontWeight: 800, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: tone }}>{count}</div>
        {zero && <div style={{ fontSize: 11, color: T.open, fontWeight: 700 }}>CLEAR</div>}
      </div>
      <div style={{ fontSize: 11, color: T.inkSoft, minHeight: 30 }}>{hint}</div>
      <GhostButton onClick={onClick} disabled={zero}
                   style={{ padding: '6px 10px', fontSize: 11,
                            opacity: zero ? 0.5 : 1 }}>
        {ctaLabel}
      </GhostButton>
    </Card>
  );
}

function BigStat({ label, value, muted, tone }) {
  const color = tone === 'warn' ? T.brass : tone === 'closed' ? T.closed
              : muted ? T.inkMute : T.ink;
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1.2, color: T.inkMute,
                    fontWeight: 800, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color, marginTop: 2 }}>
        {value ?? 0}
      </div>
    </div>
  );
}

function CoverageBar({ label, missing, total, examples, onClick }) {
  const pct = total > 0 ? Math.round(100 * (total - missing) / total) : 0;
  const complete = missing === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none', textAlign: 'left',
        padding: '6px 4px', cursor: onClick ? 'pointer' : 'default',
        display: 'grid', gap: 4,
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 }}>
        <span style={{ fontWeight: 700, color: T.ink }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontWeight: 800,
                       color: complete ? T.open : T.brass }}>
          {pct}%
        </span>
        <span style={{ color: T.inkMute, fontSize: 11 }}>
          {complete ? 'complete' : `${missing} missing`}
        </span>
      </div>
      <div style={{ position: 'relative', height: 6, background: T.parchmentDeep,
                    borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: complete ? T.open : T.brass,
        }} />
      </div>
      {!complete && examples.length > 0 && (
        <div style={{ fontSize: 10, color: T.inkMute }}>
          e.g. {examples.join(', ')}{missing > examples.length ? '…' : ''}
        </div>
      )}
    </button>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th style={{
      textAlign: align, padding: '10px 10px',
      fontSize: 10, letterSpacing: 1.2, color: T.inkMute,
      fontWeight: 800, textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', tone, muted, colSpan, style }) {
  const color =
    tone === 'ok'      ? T.open  :
    tone === 'warn'    ? T.brass :
    tone === 'closed'  ? T.closed :
    muted              ? T.inkMute :
                         T.ink;
  return (
    <td colSpan={colSpan} style={{
      padding: '10px 10px', fontSize: 12,
      textAlign: align, color, fontWeight: 700,
      verticalAlign: 'top',
      ...style,
    }}>
      {children}
    </td>
  );
}

/* Time helper — "just now", "5m ago", "3h ago", "2d ago", or the date. */
function relativeTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 45)          return 'just now';
  if (diffSec < 90)          return '1m ago';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)          return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)           return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30)          return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}
