#!/usr/bin/env python3
"""
Audit what iNat's `taxon_name` filter ACTUALLY returns for each species.

Why this exists: fetch_inat_photos.py queried observations with
`taxon_name=<scientific>`. That parameter is a fuzzy name search, not an
exact taxon filter — and when it mis-resolves, iNat returns a full page
of confidently-wrong observations rather than an error. Observed on
2026-08-14: `Sarda sarda` (Atlantic Bonito) returned `Regalecus glesne`,
the oarfish. Those photos were downloaded into the Atlantic Bonito
folder and trained on.

This script asks, per species: "if we query by name, whose photos come
back?" Any row where the returned taxon is not the requested one is a
poisoned folder.

Read-only. Deletes nothing, downloads no images.

    python3 audit_taxa.py                 # audit the live admin list
    python3 audit_taxa.py --limit 20      # quick sample
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE_DIR = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID Model"
)
UA = "reelintel-training-audit"
SLEEP = 1.0


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r)


def load_env():
    """Reuse .env.local the same way fetch_inat_photos.py does."""
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
        print("No Supabase creds in .env.local — cannot load the admin list.")
        sys.exit(1)
    q = url.rstrip("/") + "/rest/v1/species?select=common_name,scientific,is_active"
    req = urllib.request.Request(q, headers={
        "apikey": key, "Authorization": f"Bearer {key}", "User-Agent": UA,
    })
    with urllib.request.urlopen(req, timeout=45) as r:
        rows = json.load(r)
    return [(x["common_name"], x["scientific"]) for x in rows
            if x.get("is_active") is not False and x.get("scientific")]


def folder_count(common):
    d = os.path.join(BASE_DIR, common, "images")
    if not os.path.isdir(d):
        return 0
    return sum(1 for f in os.listdir(d) if f.lower().endswith(".jpg"))


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    species = load_species()
    if args.limit:
        species = species[:args.limit]
    print(f"Auditing {len(species)} species against iNat…\n")

    bad, ok, unknown = [], 0, []

    for i, (common, scientific) in enumerate(species, 1):
        q = urllib.parse.urlencode({
            "taxon_name": scientific,
            "quality_grade": "research",
            "photos": "true",
            "per_page": 5,
            "order_by": "votes",
        })
        try:
            d = http_json("https://api.inaturalist.org/v1/observations?" + q)
        except Exception as e:
            unknown.append((common, scientific, f"API error: {e}"))
            time.sleep(SLEEP)
            continue

        results = d.get("results") or []
        if not results:
            unknown.append((common, scientific, "no results"))
            time.sleep(SLEEP)
            continue

        names = [norm((o.get("taxon") or {}).get("name")) for o in results]
        want = norm(scientific)
        # Genus-level match counts as OK: a subspecies or a recent
        # rename is not contamination, a different genus is.
        want_genus = want.split(" ")[0]
        matched = sum(1 for n in names if n.startswith(want_genus))

        if matched == 0:
            got = sorted({n for n in names if n})
            bad.append((common, scientific, ", ".join(got), folder_count(common)))
            print(f"[{i}/{len(species)}] BAD  {common}: asked {scientific}, got {', '.join(got)}")
        else:
            ok += 1
            print(f"[{i}/{len(species)}] ok   {common}")

        time.sleep(SLEEP)

    print("\n" + "=" * 60)
    print(f"Clean:        {ok}")
    print(f"CONTAMINATED: {len(bad)}")
    print(f"Inconclusive: {len(unknown)}")

    if bad:
        total_photos = sum(c for *_rest, c in bad)
        print(f"\nPhotos sitting in contaminated folders: {total_photos}\n")
        print(f"{'Species':<28} {'asked for':<26} {'actually got':<30} photos")
        for common, sci, got, cnt in sorted(bad, key=lambda r: -r[3]):
            print(f"{common:<28} {sci:<26} {got:<30} {cnt}")

    if unknown:
        print("\nInconclusive (check by hand):")
        for common, sci, why in unknown:
            print(f"  {common} ({sci}): {why}")

    if bad:
        out = os.path.join(os.path.dirname(__file__), "contaminated_species.json")
        with open(out, "w") as f:
            json.dump([{"common": c, "scientific": s, "got": g, "photos": n}
                       for c, s, g, n in bad], f, indent=2)
        print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
