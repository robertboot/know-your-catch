// Source monitor — DETECTION ONLY. Fetches each watched official page,
// hashes its text, and flags changes. It never edits feed data. The
// workflow opens a PR when a source changes so a human re-verifies and
// updates the feed. This is the "constantly searches" half of the
// pipeline; publication stays human-gated.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sourcesPath = join(here, '.sources.json');
const reportPath = join(here, 'MONITOR_REPORT.md');

const data = JSON.parse(readFileSync(sourcesPath, 'utf8'));
const now = new Date().toISOString();
const changed = [];
const errors = [];

// Reduce HTML to comparable text so cosmetic markup churn doesn't
// false-positive; real regulation wording changes still move the hash.
function normalize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

for (const s of data.sources) {
  if (s.id.startsWith('_')) continue;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(s.url, { signal: ctrl.signal, headers: { 'user-agent': 'kyc-regs-monitor' } });
    clearTimeout(timer);
    if (!res.ok) { errors.push(`${s.id}: HTTP ${res.status}`); continue; }
    const hash = createHash('sha256').update(normalize(await res.text())).digest('hex');
    if (s.lastHash && s.lastHash !== hash) changed.push(s);
    s.lastHash = hash;
    s.lastChecked = now;
  } catch (e) {
    errors.push(`${s.id}: ${e.message}`);
  }
}

writeFileSync(sourcesPath, JSON.stringify(data, null, 2) + '\n');

const lines = [`# Regulations source monitor — ${now}`, ''];
if (changed.length) {
  lines.push(`## ${changed.length} source(s) changed — re-verify and update the feed`, '');
  for (const s of changed) lines.push(`- **${s.id}** (${s.jurisdiction}) — ${s.url}`);
} else {
  lines.push('No watched source changed since the last run.');
}
if (errors.length) { lines.push('', '## Fetch errors', ''); for (const e of errors) lines.push(`- ${e}`); }
writeFileSync(reportPath, lines.join('\n') + '\n');

console.log(changed.length ? `CHANGED: ${changed.map(s => s.id).join(', ')}` : 'No changes.');
if (errors.length) console.log(`Errors: ${errors.length}`);
