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
import os
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


def find_export_manifest():
    """The actual export Colab downloads. colab_run.py fetches it to
    /content/manifest.json before training; a standalone repo run has
    none (it's a runtime artifact)."""
    for c in (os.environ.get("REELINTEL_EXPORT_MANIFEST"),
              "/content/manifest.json", str(HERE / "manifest.json")):
        if c and Path(c).exists():
            return Path(c)
    return None


def check_export_matches_split(man):
    """Close the false-green gap: prove the dataset Colab will actually
    download carries the SAME train/val/test as split_manifest_v1.json.
    Before the export was wired to the manifest, preflight validated the
    manifest while the export shipped a different 85/15 split."""
    ep = find_export_manifest()
    if ep is None:
        record("export matches split manifest", WARN,
               "no export manifest found — standalone run, cannot cross-check")
        return
    if not man:
        record("export matches split manifest", FAIL, "skipped — no split manifest")
        return
    try:
        exp = json.loads(ep.read_text())
    except Exception as e:
        record("export matches split manifest", FAIL, f"unreadable export manifest: {e}")
        return
    photos = exp.get("photos") or []
    if not photos:
        record("export matches split manifest", FAIL, "export manifest has no photos")
        return

    assign = man["assignments"]
    groups = man.get("groups", {})
    no_id = 0
    missing = []
    mismatched = []
    counts = {"train": 0, "val": 0, "test": 0}
    group_splits = defaultdict(set)
    for p in photos:
        iid = p.get("id")
        got = p.get("split")
        if not iid:
            no_id += 1
            continue
        want = assign.get(iid)
        if want is None:
            missing.append(iid)
            continue
        if got != want:
            mismatched.append((iid, got, want))
        if got in counts:
            counts[got] += 1
        group_splits[groups.get(iid, f"self:{iid}")].add(got)

    overlap = [g for g, s in group_splits.items() if len(s) > 1]
    absent = [s for s in ("train", "val", "test") if counts[s] == 0]
    problems = []
    if no_id:
        problems.append(f"{no_id} exported photos have no id (old export format)")
    if missing:
        problems.append(f"{len(missing)} exported photos not in split manifest (e.g. {missing[:3]})")
    if mismatched:
        problems.append(f"{len(mismatched)} split mismatches (e.g. {mismatched[:2]})")
    if overlap:
        problems.append(f"{len(overlap)} observation groups cross splits in the export")
    if absent:
        problems.append(f"export missing split(s): {', '.join(absent)}")
    if problems:
        record("export matches split manifest", FAIL, "; ".join(problems))
    else:
        record("export matches split manifest", OK,
               f"{len(photos)} photos — train/val/test "
               f"{counts['train']}/{counts['val']}/{counts['test']}, "
               f"0 mismatch, 0 group overlap")


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


# Labels that are structurally invalid regardless of what the species
# table says. Checked WITHOUT credentials so a Colab run — which has no
# .env.local — still catches them. `_unassigned` is a real placeholder
# that reached the verified set and would otherwise have trained as a
# species; it was a hard FAIL locally and a silent WARN on Colab, which
# is exactly the false green this gate exists to prevent.
def _structurally_bad_labels(used):
    """Split into (blocking, cosmetic).

    Only a leading/trailing underscore is BLOCKING: that is the
    placeholder shape (`_unassigned`), which is not a fish and must
    never train as a class.

    Spaces and capitals are NOT blocking. 'Rainbow Runner', 'Red Hind'
    and 'skipjack tuna' are real, active, single-row species carrying
    266/226/2 verified images — there is no snake_case counterpart to
    consolidate into. An earlier version of this check failed the run on
    them, which blocked a perfectly good dataset over a naming
    convention. Untidy ids are worth reporting, not worth refusing to
    train on.
    """
    blocking, cosmetic = [], []
    for l in sorted(used):
        if l.startswith("_") or l.endswith("_"):
            blocking.append(f"{l} (placeholder — not a species)")
        elif " " in l:
            cosmetic.append(f"{l} (space in id)")
        elif l != l.lower():
            cosmetic.append(f"{l} (not lowercase)")
    return blocking, cosmetic


def check_label_mapping(man):
    env = load_env()
    url = (env.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
           or os.environ.get("VITE_SUPABASE_URL"))
    key = (env.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY")
           or os.environ.get("VITE_SUPABASE_ANON_KEY"))

    if not man:
        record("labels map to species", FAIL, "skipped — no manifest")
        return
    used = set(man.get("species", {}).values())

    if not (url and key):
        # Credential-free fallback. Cannot confirm every label IS an
        # active species, but can still reject the ones that cannot be
        # one. Reported as FAIL when structurally bad, WARN otherwise —
        # never silently PASS.
        blocking, cosmetic = _structurally_bad_labels(used)
        if blocking:
            record("labels map to species", FAIL,
                   f"no creds, but {len(blocking)} placeholder label(s) must "
                   f"not train: {'; '.join(blocking[:4])}")
        else:
            note = (f" ({len(cosmetic)} untidy id(s): "
                    f"{', '.join(cosmetic[:3])})" if cosmetic else "")
            record("labels map to species", WARN,
                   f"no creds to reach the species table — {len(used)} labels "
                   f"pass a structural check only{note}. Set SUPABASE_URL + "
                   f"SUPABASE_ANON_KEY in the Colab cell for the full check.")
        record("scientific names resolved", WARN, "no creds to verify")
        return
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/species?select=id,scientific,is_active",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    rows = json.load(urllib.request.urlopen(req, timeout=45))
    active = {r["id"] for r in rows if r.get("is_active") is not False}
    no_sci = {r["id"] for r in rows
              if r.get("is_active") is not False
              and not (r.get("scientific") or "").strip()}

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


EXIF_TEST_URL = (
    "https://raw.githubusercontent.com/robertboot/know-your-catch/"
    "claude/upload-app-assets-NUxRr/training/tests/test_exif_parity.py"
)


def check_exif():
    test = HERE / "tests" / "test_exif_parity.py"
    if not test.exists():
        # Colab fetches preflight.py standalone, so the tests/ directory
        # is not present. Pull the test rather than failing on its
        # absence — "test file missing" told us nothing about the data
        # and blocked a run whose dataset was fine.
        try:
            test.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(EXIF_TEST_URL, str(test))
            print(f"       (fetched {test.name} — not present locally)")
        except Exception as e:
            record("EXIF normalization", FAIL,
                   f"test file missing and could not be fetched: {e}")
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
    check_export_matches_split(man)
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
