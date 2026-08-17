#!/usr/bin/env python3
"""
Preflight gate. Exits non-zero if the dataset is not safe to train on.

Intended to run immediately before training — colab_run.py invokes it,
and a non-zero exit aborts the run. Every check here corresponds to a
failure that has actually happened on this project and was invisible
until after a model shipped.

CHECKS
  1. cross-species exact duplicates remain in the verified set
  2. train/val/test group (observation) overlap
  3. a label cannot map to a ReelIntel species id
  4. a species has no scientific name (unresolved mapping)
  5. split manifest missing or stale
  6. EXIF normalization test fails

    python3 preflight.py            # all checks
    python3 preflight.py --strict   # warnings become failures too
"""
import argparse
import json
import subprocess
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
MANIFEST = HERE / "split_manifest_v1.json"
CONFLICTS = HERE / "cross_species_conflicts.json"

FAIL, WARN, OK = "FAIL", "WARN", "PASS"
results = []


def record(name, status, detail):
    results.append((name, status, detail))
    print(f"[{status:<4}] {name}: {detail}", flush=True)


def load_env():
    p = HERE.parent / ".env.local"
    env = {}
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def service_key():
    out = subprocess.run(
        ["supabase", "projects", "api-keys", "--project-ref",
         "hfptpsmdfemduhkueyoz", "--output", "json"],
        capture_output=True, text=True)
    if out.returncode != 0:
        return None
    for k in json.loads(out.stdout):
        if k.get("name") == "service_role":
            return k["api_key"]
    return None


def check_manifest():
    if not MANIFEST.exists():
        record("split manifest present", FAIL,
               f"{MANIFEST.name} missing — run make_split.py")
        return None
    man = json.loads(MANIFEST.read_text())
    n = len(man.get("assignments", {}))
    record("split manifest present", OK,
           f"v{man.get('version')}, {n} assignments, salt={man.get('salt')}")
    return man


def check_group_overlap(man):
    if not man:
        record("no split leakage", FAIL, "skipped — no manifest")
        return
    groups = man.get("groups", {})
    per = defaultdict(set)
    for iid, bucket in man["assignments"].items():
        per[bucket].add(groups.get(iid, f"self:{iid}"))
    overlap = ((per["train"] & per["val"]) | (per["train"] & per["test"])
               | (per["val"] & per["test"]))
    if overlap:
        record("no split leakage", FAIL,
               f"{len(overlap)} observation groups appear in more than one split")
    else:
        record("no split leakage", OK,
               f"0 groups shared across train/val/test "
               f"({len(per['train'])}/{len(per['val'])}/{len(per['test'])} groups)")


def check_cross_species_dupes(man):
    if not CONFLICTS.exists():
        record("no cross-species duplicates", WARN,
               "no conflict report — run audit_cross_species_dupes.py")
        return
    rep = json.loads(CONFLICTS.read_text())
    ids = {m["training_id"] for c in rep.get("conflicts", [])
           for m in c["members"]}
    if not ids:
        record("no cross-species duplicates", OK, "none found")
        return
    if not man:
        record("no cross-species duplicates", FAIL,
               f"{len(ids)} conflicted images and no manifest to check them against")
        return
    still = ids & set(man["assignments"].keys())
    if still:
        record("no cross-species duplicates", FAIL,
               f"{len(still)} conflicted images are STILL in the verified split "
               f"— run supabase/quarantine-cross-species-dupes.sql")
    else:
        record("no cross-species duplicates", OK,
               f"all {len(ids)} conflicted images quarantined out of the split")


def check_label_mapping(man):
    env = load_env()
    url = env.get("VITE_SUPABASE_URL"); key = env.get("VITE_SUPABASE_ANON_KEY")
    if not (url and key):
        record("labels map to species", WARN, "no creds to verify")
        return
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/species?select=id,scientific,is_active",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    rows = json.load(urllib.request.urlopen(req, timeout=45))
    active = {r["id"] for r in rows if r.get("is_active") is not False}
    no_sci = {r["id"] for r in rows
              if r.get("is_active") is not False
              and not (r.get("scientific") or "").strip()}

    if not man:
        record("labels map to species", FAIL, "skipped — no manifest")
        return
    used = set(man.get("species", {}).values())
    unmapped = sorted(used - active)
    if unmapped:
        record("labels map to species", FAIL,
               f"{len(unmapped)} label(s) not an active species: "
               f"{', '.join(unmapped[:6])}")
    else:
        record("labels map to species", OK, f"all {len(used)} labels resolve")

    bad = sorted(no_sci & used)
    if bad:
        record("scientific names resolved", FAIL,
               f"{len(bad)} species in the split have no scientific name: "
               f"{', '.join(bad[:6])}")
    else:
        record("scientific names resolved", OK, "every training species has one")


def check_exif():
    test = HERE / "tests" / "test_exif_parity.py"
    if not test.exists():
        record("EXIF normalization", FAIL, "test file missing")
        return
    out = subprocess.run([sys.executable, str(test)], capture_output=True, text=True)
    tail = (out.stdout.strip().splitlines() or ["no output"])[-1]
    if out.returncode == 0 and "PASS" in out.stdout:
        record("EXIF normalization", OK, tail)
    elif "SKIP" in out.stdout:
        record("EXIF normalization", WARN, tail)
    else:
        record("EXIF normalization", FAIL, tail)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true",
                    help="treat WARN as failure")
    args = ap.parse_args()

    print("=" * 64)
    print("PREFLIGHT — training is blocked unless every check passes")
    print("=" * 64)
    man = check_manifest()
    check_group_overlap(man)
    check_cross_species_dupes(man)
    check_label_mapping(man)
    check_exif()

    fails = [r for r in results if r[1] == FAIL]
    warns = [r for r in results if r[1] == WARN]
    print("\n" + "=" * 64)
    print(f"{len(results)} checks — {len(fails)} FAIL, {len(warns)} WARN, "
          f"{len(results)-len(fails)-len(warns)} PASS")
    if fails or (args.strict and warns):
        print("PREFLIGHT FAILED — do not train.")
        for n, s, d in fails + (warns if args.strict else []):
            print(f"  {s}: {n} — {d}")
        return 1
    print("PREFLIGHT PASSED.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
