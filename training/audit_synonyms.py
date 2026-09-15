#!/usr/bin/env python3
"""
Find species rows that are the SAME FISH under two different names.

The obvious duplicate check — two active rows sharing a scientific name —
is a plain SQL group-by and finds nothing today. This is the harder case
it cannot see: two DIFFERENT scientific names that iNat resolves to the
same taxon, i.e. one is a synonym of the other.

That is how the Yelloweye Snapper error hid. Its row said Rhomboplites
aurorubens (Vermilion's name), so a same-name check would only have
flagged it against Vermilion — and had it instead carried a stale
synonym of Lutjanus vivanus, nothing would have flagged it at all.

Read-only. Hits the iNat taxa endpoint once per species and prints any
taxon id claimed by more than one active species row.

    python3 audit_synonyms.py
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_inat_photos as fetcher   # reuse the resolver, don't fork it

UA = "reelintel-synonym-audit"
SLEEP = 1.0


def load_env():
    path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    env = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_species():
    env = load_env()
    url = env.get("VITE_SUPABASE_URL") or env.get("SUPABASE_URL")
    key = env.get("VITE_SUPABASE_ANON_KEY") or env.get("SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("No Supabase creds in .env.local")
    q = (url.rstrip("/")
         + "/rest/v1/species?select=id,common_name,scientific,is_active")
    req = urllib.request.Request(q, headers={
        "apikey": key, "Authorization": f"Bearer {key}", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        rows = json.load(r)
    return [r for r in rows if r.get("is_active") is not False]


def main():
    species = load_species()
    print(f"Resolving {len(species)} active species to iNat taxa…\n")

    by_taxon = defaultdict(list)
    unresolved = []

    for i, r in enumerate(species, 1):
        sci = (r.get("scientific") or "").strip()
        if not sci:
            unresolved.append((r["common_name"], "(no scientific name)"))
            continue
        tid, name = fetcher.resolve_taxon(sci)
        if not tid:
            unresolved.append((r["common_name"], sci))
        else:
            by_taxon[tid].append((r["common_name"], sci, name))
        if i % 25 == 0:
            print(f"  … {i}/{len(species)}", flush=True)
        time.sleep(SLEEP)

    clashes = {t: v for t, v in by_taxon.items() if len(v) > 1}

    print("\n" + "=" * 62)
    print(f"Active species:        {len(species)}")
    print(f"Distinct iNat taxa:    {len(by_taxon)}")
    print(f"SYNONYM CLASHES:       {len(clashes)}")
    print(f"Unresolved:            {len(unresolved)}")

    if clashes:
        print("\nSame iNat taxon claimed by more than one active species —")
        print("these are the same fish under two names:\n")
        for tid, group in sorted(clashes.items()):
            print(f"  taxon {tid} ({group[0][2]})")
            for common, sci, _ in group:
                print(f"      {common:<28} carries '{sci}'")
            print()

    if unresolved:
        print("Unresolved (no iNat match — check by hand):")
        for common, sci in unresolved:
            print(f"  {common:<28} {sci}")

    if not clashes:
        print("\nNo synonym clashes. Every active species maps to a "
              "distinct iNat taxon.")


if __name__ == "__main__":
    main()
