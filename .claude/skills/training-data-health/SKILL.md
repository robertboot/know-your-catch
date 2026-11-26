---
name: training-data-health
description: Use before blaming the model for a wrong species ID, before a Colab retrain, and whenever adding, merging, quarantining or reviewing training images. Records the class-size floor, the species pairs that must never be separate labels, and what the duplicate quarantine does NOT do.
---

# Training data health

A wrong ID is a data question before it is a model question. Check
[[harness-parity]] first — that the thing reporting the fault runs the
app's code — then check the data here. Only then consider the weights.

## The three failure shapes, all seen in production

### 1. An under-trained class fires on everything

A vermilion snapper came back as a **glass minnow**. Vermilion's data was
excellent: 769 images, 756 separate observations, no conflicts. Glass
minnow had been cut to **72 images** by the duplicate quarantine, cleared
the 30-image floor, and stayed in the model as a class with no tight shape
to its decision region. A loose region fires on things it should not.

**Rule: the floor keeps junk out, it does not make a class good.**
`DEFAULT_MIN_IMAGES = 30` in `train_fish_id.py` (mirrored as
`MIN_TRAIN_THRESHOLD` in `src/training-store.js` — change both). Median
class is ~317. Anything under ~120 verified is fragile and worth naming in
a review, not just counting.

Audit query:

```sql
with counts as (
  select species_id, count(*) filter (where status = 'verified') as verified
  from training_images group by species_id
)
select c.species_id, s.common_name, c.verified
from counts c left join species s on s.id = c.species_id
where c.verified < 120 and coalesce(s.is_active, true)
order by c.verified;
```

### 2. Two labels for one thing a photo cannot separate

If two classes are told apart by something a 224-pixel photo does not
contain, they are not two classes — they are one class and a coin flip,
and the duplicate detector proves it by finding the same photograph filed
under both.

Merged so far:

| Merged into | Absorbed | Why a photo cannot decide |
|---|---|---|
| `glass_minnow` "Glass Minnow" | `bay_anchovy`, `striped_anchovy` | Anchoa spp., separated by stripe width in the hand. 883 identical photos across the three. |
| `gulf_sturgeon` "Sturgeon" | `atlantic_sturgeon` | Subspecies of *A. oxyrinchus*, separated by spleen and head-length ratios. What decides is where it was caught. |
| `smalltooth_sawfish` "Sawfish" | `largetooth_sawfish` | Distinguishable in principle (22-29 rostral tooth pairs vs 14-22), but all 110 Smalltooth photos were the same iNaturalist photo already filed under Largetooth, so there is no data to learn the difference from. Merged until there is. |

Visible difference is **not** sufficient on its own. The sawfish pair does
differ visibly — 22–29 rostral tooth pairs vs 14–22, and smalltooth has
almost no lower tail lobe — and was still merged, because there is no
genuine data for one side to learn it from. Ask both questions: *can a
photograph decide it*, and *do we hold photographs that did*.

The test is **"can a photograph decide?"**, not "are these different
animals?". Sturgeon subspecies are different animals and still one label.

When merging, keep the id the app actually shows, re-point
`training_images` AND `catches`, move the regulation entry in `src/data.js`
to the surviving id, deactivate the absorbed row (`is_active = false`,
never delete), and give the survivor a name that is not wrong in the other
subspecies' water — "Sturgeon", not "Gulf Sturgeon".

### 2b. The same photograph fetched twice under two names

Before sending duplicate pairs to a human for review, **check whether they
are even two photographs.** Our filenames carry the source photo id
(`<species>_<inat_photo_id>.jpg`), so this is a one-line test:

```python
# do both members of a conflict carry the SAME iNaturalist photo id?
re.search(r'_(\d+)\.jpg$', filename).group(1)
```

All 110 Smalltooth/Largetooth Sawfish conflicts shared an id. So did all 56
Gulf/Atlantic Sturgeon ones. Those were never two fish — they were one
picture downloaded twice under two species names, the `taxon_name`
mis-resolution that also fetched 999 oarfish as Atlantic Bonito.
`fetch_inat_photos.py` resolves by `taxon_id` now, but older photos predate
that fix.

Two consequences, both easy to get wrong:

- **A human cannot resolve it.** 88 sawfish photos went out for review and
  every call was the same picture twice. There was nothing to decide.
- **It can mean a class has no data at all.** Smalltooth's entire class —
  31 verified plus 79 rejected — was exactly those 110 duplicates. Not one
  photograph of its own. When that happens you do not know which species
  the surviving pictures show, so do not name either: merge, and split
  again when there are genuine taxon-verified photos. (Both sawfish are
  no-take, so the regulation was unaffected. Check that before merging two
  species whose rules differ.)

### 3. The quarantine rejects BOTH copies and picks no label

`supabase/quarantine-cross-species-dupes.sql` says it out loud: *"No label
was auto-selected. Every entry needs human review."* Nobody reviewed, and
months later **Gulf Sturgeon and Smalltooth Sawfish were both at zero
verified images** — every photo either had was a duplicate of its sibling,
so every photo was rejected. Both are federally protected, and a class at
zero is worse than missing: the photo gets confidently named as the
sibling.

**Rule: after running a quarantine, check what it emptied.** The same
query as above, looking for zeros. Then either merge the pair (if a photo
cannot decide) or restore the conflicts to `pending` so they reach the
Review tab:

```sql
update training_images
   set status = 'pending', reviewed_by = null,
       reviewed_at = null, rejection_reason = null
 where status = 'rejected' and rejection_reason = 'duplicate'
   and species_id in (...);
```

Do **not** restore duplicates into a class you have just merged.
`make_split.py` groups by iNaturalist observation, not by content hash, so
two copies of one photograph can land in train and val and inflate every
accuracy number the retrain reports.

## Also true

- **Images are not fish.** Count `unique_observations`, not
  `total_images`. Blackbelly Rosefish shows 203 images from 72 animals;
  Great White 513 from 235. Shark classes are the worst offenders.
- **A dropped class is a silent wrong answer.** 25 species sit below the
  floor, several of which the app publishes regulations for — White
  Marlin, Blueline Tilefish, Speckled Hind, Lesser Amberjack. A photo of
  one does not fail; it gets named something else. Either top the class up
  ([[inat-photo-fetch]]) or accept it knowingly.
- **Check the scraper got the right animal.** `training/audit_taxa.py`
  writes `contaminated_species.json`. It caught a lookup for *Sarda sarda*
  (Atlantic Bonito) returning *Regalecus glesne* — the oarfish — with 1000
  photos queued. Run it after any fetch. A genus rename (Epinephelus →
  Hyporthodus for Speckled Hind) is a false positive, not contamination.
- `dataset_report.json` and `cross_species_conflicts.json` are snapshots
  with a `generated_at`. Check the date before trusting a count; both were
  read months stale during one investigation.

## A gate must understand resolution, not just presence

Colab's preflight blocked three runs on "80 conflicted images are STILL in
the verified split". All 80 were the single surviving copy of a pair whose
twin had been quarantined, or photos in two classes that had since been
merged into one. They were the resolution, and the gate was reading them as
the problem — it tested whether a conflicted id was present at all.

A duplicate only matters while it is CONTRADICTORY. The split manifest
carries each image's current species, so the question is: of the members
still in the split, do any two sit under *different* labels? One survivor,
or several now under one merged label, is resolved. `preflight.py` asks
that now.

Worth remembering when writing any gate: a check that cannot tell a fixed
problem from a live one will be overridden, and `REELINTEL_SKIP_PREFLIGHT=1`
is right there in the error message.

## Order of work before a retrain

Data first, export second, Colab third. A retrain on unexamined data buys
a new model with the same faults and costs a day finding that out.
