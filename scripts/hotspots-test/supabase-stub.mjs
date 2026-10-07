// Minimal stand-in for @supabase/supabase-js: records every write.
export const writes = { hotspots: [], hotspot_zones: [], updates: [], deletes: [] };
export const seed = { hotspot_regions: [], catches: [] };
function table(name) {
  const api = {
    _filters: {},
    select() { return api; },
    eq(k, v) { api._filters[k] = v; return api; },
    gte() { return api; }, lt() { return api; }, order() { return api; }, limit() { return api; },
    upsert(rows) { writes[name] = (writes[name] || []).concat(rows); return Promise.resolve({ error: null }); },
    insert(rows) { writes[name] = (writes[name] || []).concat(rows); return Promise.resolve({ error: null }); },
    update(patch) { writes.updates.push({ name, patch }); return { eq: () => Promise.resolve({ error: null }) }; },
    delete() {
      writes.deletes.push(name);
      const chain = { eq: () => chain, lt: () => chain, then: (r) => Promise.resolve({ error: null }).then(r) };
      return chain;
    },
    then(res) { return Promise.resolve({ data: seed[name] || [], error: null }).then(res); },
  };
  return api;
}
export function createClient() {
  return { from: table, rpc: async () => ({ data: true, error: null }), storage: { from: () => ({ upload: async () => ({ error: null }) }) } };
}
