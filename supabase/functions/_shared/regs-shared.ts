/* Shared pieces for the two regulation-research edge functions
   (research-regulations — admin-interactive, and
    auto-update-regulations — cron). One copy of the validation
   bounds, jurisdiction table, and Anthropic response plumbing so
   the human-reviewed path and the auto-publish path can't drift
   apart silently. */

export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_MODEL    = 'claude-sonnet-5';
export const ANTHROPIC_VERSION  = '2023-06-01';

// Mirrors src/data.js JURISDICTIONS (names + regsUrls must match —
// the regsUrl is both the link anglers tap and the page the AI is
// steered to search first).
export const JURISDICTIONS = [
  { id: 'al_state', name: 'Alabama State Waters',      agency: 'Alabama DCNR', regsUrl: 'https://www.outdooralabama.com/fishing/saltwater-fishing' },
  { id: 'fl_state', name: 'Florida Gulf State Waters', agency: 'FWC',          regsUrl: 'https://myfwc.com/fishing/saltwater/recreational/' },
  { id: 'ms_state', name: 'Mississippi State Waters',  agency: 'MDMR',         regsUrl: 'https://dmr.ms.gov/' },
  { id: 'la_state', name: 'Louisiana State Waters',    agency: 'LDWF',         regsUrl: 'https://www.wlf.louisiana.gov/' },
  { id: 'tx_state', name: 'Texas State Waters',        agency: 'TPWD',         regsUrl: 'https://tpwd.texas.gov/regulations/outdoor-annual/fishing/saltwater-fishing' },
  { id: 'fed_gulf', name: 'Federal Gulf Waters',       agency: 'NOAA / GMFMC', regsUrl: 'https://www.fisheries.noaa.gov/southeast/recreational-fishing/recreational-fishing-gulf-mexico' },
];

// Plausibility bounds — any numeric outside these is dropped to null
// and noted so it can be surfaced in sourceNote.
export const RANGES: Record<string, [number, number]> = {
  minSizeIn: [0, 120],
  maxSizeIn: [0, 200],
  bagLimit:  [0, 1000],
  boatLimit: [0, 5000],
};

export function coerceNumeric(
  raw: unknown,
  key: keyof typeof RANGES,
  rejects: string[],
): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const [lo, hi] = RANGES[key];
  if (n < lo || n > hi) {
    rejects.push(`AI suggested ${key}=${raw} — rejected as implausible (allowed ${lo}-${hi}).`);
    return null;
  }
  return n;
}

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/* With web search enabled, the Messages content array interleaves
   server_tool_use / web_search_tool_result / text blocks. The final
   text block carries the model's answer. */
export function finalTextBlock(anthropicJson: any): string {
  const textBlocks = Array.isArray(anthropicJson?.content)
    ? anthropicJson.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    : [];
  return textBlocks.length ? textBlocks[textBlocks.length - 1].text : '';
}

/* Strip markdown fences, then salvage the outermost object literal
   if the model led with prose despite instructions. Returns null on
   unparseable input. */
export function salvageJson(rawText: string): Record<string, unknown> | null {
  const stripped = rawText.replace(/^```(?:json)?\n/, '').replace(/\n```\s*$/, '').trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
