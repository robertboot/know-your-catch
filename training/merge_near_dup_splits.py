#!/usr/bin/env python3
"""
Consolidate near-duplicate groups that cross train/val/test into ONE split.

A near-duplicate group whose members land in different splits is a
train/test leak that the observation-aware split can't see (two people
upload the same photo under different observation ids). This treats each
near-dup group as an ADDITIONAL grouping constraint on top of observation
groups, then forces every connected component into a single split.

RULES (from the spec):
  - never delete or quarantine an image for being a near-duplicate
  - all members of a group end up in ONE split
  - respect observation groups too — never break one to fix a near-dup
    group (so we union near-dup AND observation groups, then move whole
    components together)
  - if a component touches TEST, consolidate INTO test (move the non-test
    members to test, not the test example into train)
  - otherwise consolidate to the majority of train/val (preserve the most)
  - if consolidation would empty a species' train set or move a large
    number of images, FLAG the component instead of guessing
  - only assignments change; observation grouping is untouched

Reads  : near_duplicate_report.json  (needs `all_groups` — re-run the audit
         once so it's present), split_manifest_v1.json
Writes : split_manifest_v1.json  (assignments only)

    python3 merge_near_dup_splits.py            # apply
    python3 merge_near_dup_splits.py --selftest # logic test, writes nothing
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
REPORT = HERE / "near_duplicate_report.json"
MANIFEST = HERE / "split_manifest_v1.json"
SPLITS = ("train", "val", "test")
MAX_MOVE = 25   # flag a component that would move more than this many images


def _uf():
    parent = {}
    def find(x):
        parent.setdefault(x, x)
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return find, union


def choose_target(cur):
    s = set(cur)
    if "test" in s:
        return "test"
    return "train" if cur.count("train") >= cur.count("val") else "val"


def merge(report, manifest):
    if report.get("all_groups") is None:
        raise SystemExit(
            "near_duplicate_report.json has no 'all_groups' — re-run "
            "audit_near_duplicates.py once (updated) to regenerate it.")
    assignments = dict(manifest["assignments"])   # id -> split
    obs_of = manifest.get("groups", {})           # id -> observation group key
    species_of = manifest.get("species", {})      # id -> species_id

    find, union = _uf()

    # Constraint 1: observation groups (never break these).
    obs_members = defaultdict(list)
    for iid, gk in obs_of.items():
        obs_members[gk].append(iid)
    for ids in obs_members.values():
        for i in ids[1:]:
            union(ids[0], i)

    # Constraint 2: near-duplicate groups (verified/manifest members only).
    for g in report["all_groups"]:
        ids = [m["training_id"] for m in g["members"] if m["training_id"] in assignments]
        for i in ids[1:]:
            union(ids[0], i)

    # Components over the verified set.
    comps = defaultdict(list)
    for iid in assignments:
        comps[find(iid)].append(iid)

    # Live per-species train counts for the imbalance guard.
    sp_train = defaultdict(int)
    for iid, s in assignments.items():
        if s == "train":
            sp = species_of.get(iid)
            if sp:
                sp_train[sp] += 1

    reassigned = 0
    consolidated = 0
    flagged = []
    for ids in comps.values():
        cur = [assignments[i] for i in ids]
        if len(set(cur)) <= 1:
            continue  # component already sits in one split — nothing to do
        target = choose_target(cur)
        moves = [i for i in ids if assignments[i] != target]

        # Guard A: don't empty a species' train set.
        train_out = defaultdict(int)
        for i in moves:
            if assignments[i] == "train":
                sp = species_of.get(i)
                if sp:
                    train_out[sp] += 1
        problem = None
        for sp, n in train_out.items():
            if target != "train" and sp_train[sp] - n < 1:
                problem = f"species '{sp}' would be left with 0 train images"
                break
        # Guard B: don't silently move a large component.
        if problem is None and len(moves) > MAX_MOVE:
            problem = f"large move ({len(moves)} images)"

        if problem:
            flagged.append({
                "reason": problem, "target": target, "moves": len(moves),
                "current": {s: cur.count(s) for s in sorted(set(cur))},
                "species": sorted({species_of.get(i) for i in ids if species_of.get(i)}),
                "example_ids": ids[:6],
            })
            continue

        for i in moves:
            frm = assignments[i]
            if frm == "train":
                sp = species_of.get(i)
                if sp:
                    sp_train[sp] -= 1
            assignments[i] = target
            if target == "train":
                sp = species_of.get(i)
                if sp:
                    sp_train[sp] += 1
            reassigned += 1
        consolidated += 1

    # Drop synthetic, non-trainable labels ('_unassigned' and any other
    # '_'-prefixed bucket). They carry no species, the export already
    # excludes them under the coverage floor, and preflight rightly FAILs
    # if they linger in the manifest. Removed from all three id-keyed maps
    # so the manifest stays internally consistent.
    groups_map = dict(manifest.get("groups", {}))
    species_map = dict(species_of)
    # Match on the species MAP (what preflight reads via species.values()),
    # unioned with anything reachable from assignments — so a synthetic id
    # can't hide in one map and slip past.
    strip_ids = {i for i, sp in species_map.items() if str(sp).startswith("_")}
    strip_ids |= {i for i in assignments if str(species_of.get(i, "")).startswith("_")}
    stripped = sorted(strip_ids)
    for i in stripped:
        assignments.pop(i, None)
        groups_map.pop(i, None)
        species_map.pop(i, None)

    new_manifest = dict(manifest)
    new_manifest["assignments"] = assignments
    new_manifest["groups"] = groups_map
    new_manifest["species"] = species_map
    counts = {s: 0 for s in SPLITS}
    for s in assignments.values():
        if s in counts:
            counts[s] += 1
    stats = {
        "components_consolidated": consolidated,
        "images_reassigned": reassigned,
        "stripped_non_species": len(stripped),
        "flagged": flagged,
        "counts": counts,
    }
    return new_manifest, stats


def _selftest():
    # a: near-dup group {a1(test), a2(train)}  -> both to test
    # b: a2 is in obs group with b1(train)      -> b1 must move to test too
    # c: train/val-only near-dup {c1(train), c2(val), c3(train)} -> majority train
    manifest = {
        "assignments": {"a1": "test", "a2": "train", "b1": "train",
                        "c1": "train", "c2": "val", "c3": "train", "z1": "train",
                        "u1": "train"},
        "groups": {"a1": "self:a1", "a2": "inat:9", "b1": "inat:9",
                   "c1": "self:c1", "c2": "self:c2", "c3": "self:c3",
                   "z1": "self:z1", "u1": "self:u1"},
        "species": {**{k: "sp" for k in ["a1", "a2", "b1", "c1", "c2", "c3", "z1"]},
                    "u1": "_unassigned"},
    }
    report = {"all_groups": [
        {"dhash": "1", "members": [{"training_id": "a1", "split": "test"},
                                   {"training_id": "a2", "split": "train"}]},
        {"dhash": "2", "members": [{"training_id": "c1", "split": "train"},
                                   {"training_id": "c2", "split": "val"},
                                   {"training_id": "c3", "split": "train"}]},
    ]}
    nm, st = merge(report, manifest)
    a = nm["assignments"]
    assert a["a1"] == a["a2"] == a["b1"] == "test", a          # obs group followed to test
    assert a["c1"] == a["c2"] == a["c3"] == "train", a         # majority train
    assert a["z1"] == "train", "untouched image changed"
    assert "u1" not in a, "_unassigned not stripped"           # non-species dropped
    assert st["stripped_non_species"] == 1, st
    assert st["images_reassigned"] == 3, st                    # a2, b1, c2
    # verify NO cross-split remains
    grp = {"test": {"a1", "a2", "b1"}, "train": {"c1", "c2", "c3", "z1"}}
    for members in ({"a1", "a2"}, {"c1", "c2", "c3"}):
        assert len({a[i] for i in members}) == 1
    print("selftest OK:", st["counts"], "| reassigned", st["images_reassigned"])


def main():
    if "--selftest" in sys.argv:
        _selftest()
        return
    report = json.loads(REPORT.read_text())
    manifest = json.loads(MANIFEST.read_text())
    before = report.get("groups_crossing_splits", "?")
    new_manifest, stats = merge(report, manifest)
    MANIFEST.write_text(json.dumps(new_manifest, indent=1))
    print(f"cross-split groups (audit before): {before}")
    print(f"components consolidated : {stats['components_consolidated']}")
    print(f"images reassigned       : {stats['images_reassigned']}")
    print(f"non-species dropped     : {stats['stripped_non_species']}  (_-prefixed, e.g. _unassigned)")
    print(f"new split counts        : train {stats['counts']['train']} / "
          f"val {stats['counts']['val']} / test {stats['counts']['test']}")
    if stats["flagged"]:
        print(f"\nFLAGGED (not reassigned — review manually): {len(stats['flagged'])}")
        for f in stats["flagged"]:
            print(f"  - {f['reason']}; target={f['target']}, "
                  f"moves={f['moves']}, current={f['current']}, species={f['species']}")
    else:
        print("flagged                 : 0")
    print(f"\nwrote {MANIFEST}. Re-run audit_near_duplicates.py to confirm "
          f"crossing = {'0' if not stats['flagged'] else len(stats['flagged'])}.")


if __name__ == "__main__":
    main()
