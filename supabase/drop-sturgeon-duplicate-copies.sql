-- Drop the duplicate copies the sturgeon merge should never have restored.
--
-- My mistake, and the repo said not to make it: merge-sturgeon-classes.sql
-- step 2 put every quarantined duplicate back for review. All 56 of those
-- pairs carry THE SAME iNaturalist photo id on both sides — one photograph
-- fetched twice under two species names — so review had nothing to decide
-- and approved both copies. The class now holds ~22 photographs twice.
--
-- That matters because make_split.py groups by iNaturalist OBSERVATION, not
-- by content. The two copies carry different observation ids, so they can
-- land in train and val, and every accuracy number the retrain prints would
-- be inflated by a model scoring pictures it had already memorised.
--
-- These are the 56 former gulf_sturgeon-side ids. Their twins (the
-- atlantic_sturgeon-side copies, now merged into the same class) stay
-- verified, so every photograph is still represented exactly once.
--
-- Idempotent.

update training_images
   set status           = 'rejected',
       rejection_reason = 'duplicate',
       reviewed_at      = now()
 where species_id = 'gulf_sturgeon'
   and id in (
  '02482bf4-6c3f-315d-5517-411cfd076acf',
  '0441cd84-7cbd-3b52-282e-7ac24819ba77',
  '050c2e06-fe22-757b-09fa-3db858d9663c',
  '05de7921-ed69-911b-dbf3-32dea2633fd4',
  '075eef73-7b86-79de-9bc8-7db88094c3fb',
  '093a9da6-7318-018f-9cbb-333e844cf8ed',
  '0ea630e2-f1e8-09cb-cd11-ef4f90a27223',
  '11bb0df3-13e3-e893-9aba-67338b4abe6e',
  '172c1d25-8716-6291-6b10-96d3deddcb73',
  '1ec2fd4e-2232-ab96-fd2e-5e704f42821b',
  '26643319-16c7-4b4e-4fd1-550e954652cc',
  '2d83b283-7f43-145f-52be-d0cfab75edfb',
  '30cba3bf-1438-1c21-f26c-ed820eb04fa2',
  '324a9cfe-73da-99b0-0da1-d3ad2b2c00c1',
  '36610ec8-ebac-18bb-97ab-347ab473d4e0',
  '3810ff49-d67a-110a-e382-61f5994f0c42',
  '3b39f22f-867c-82c9-75db-328225d083a0',
  '4318110a-f8b4-0f78-d90c-6c9184c48a98',
  '47ed7636-c6c6-887f-696f-f7e4e19174f0',
  '4c4485d3-3132-a7d0-0552-843e0afb349b',
  '4f90a0fa-656c-86f8-b0fc-01b2371269fb',
  '4f918374-e01b-a986-c2cf-3cafc6fa5766',
  '5e6e7be6-a869-5a2b-60e8-4533030c36f9',
  '663bf8d5-91dc-708e-0144-0d673edef154',
  '6a8e17f6-7d81-3441-ca7d-3ddd14e889dc',
  '6ae0f231-c0fb-f65c-65e8-bb36a580b825',
  '6f8180ff-054b-ea6f-8444-4501560939ad',
  '7ed0edd0-a60f-e919-c027-32a5c2795fa7',
  '7f8bb590-ca1c-ae56-78f8-62070478e1e6',
  '808641a6-e8f2-d51e-9671-323214fd4f60',
  '824d7493-6328-e5ce-6795-ab891ea0c5a6',
  '8835fd0f-ad1f-b5b1-3fee-dbaff89f2195',
  '89b8cb2b-2476-8a20-9d4e-80f172456739',
  '92626898-9287-1078-4e7c-8723b7ab6574',
  '9cb5037b-b8d6-6d80-8225-f6d6cabd3458',
  '9d4d0918-3f64-60cd-c0a1-d0563763ebfc',
  'b3c2be38-a387-3518-05b4-aa7c4b073e9c',
  'b858b428-664c-c2d3-55f0-6d4ec7d18c75',
  'c05a4888-6a5d-23fc-a17b-1e520ce8ff18',
  'c136618c-a4e8-0bed-2122-c6c495e1503a',
  'c5594e81-42da-3e50-5682-8127dcd5f065',
  'c5a9202d-a1d2-815d-ca4c-66bccb17e021',
  'c6b579ae-b390-ecd3-c0c5-805a78ea6877',
  'c7efdc0f-6434-5adb-2121-34d168ce42f9',
  'ca97c844-fc46-9dcf-6a6c-09b734f5768b',
  'd760a8c2-bc3f-cca2-2fe0-b507e14f933f',
  'd8eb6a4c-f68d-e385-7d7f-cae0692a0712',
  'df6518c5-c3fa-795b-cd05-295226f61a12',
  'e53343ce-bca8-716a-1cc1-c2a76329f0ea',
  'e8841025-169e-dda4-7adb-d16716b931ec',
  'eb36732a-014e-3b4f-c9ae-7a8aa1894395',
  'ee89f95d-6e2d-9344-05e5-793dd66e8e83',
  'f36c6ada-b5d9-b519-65b5-c3037af73a14',
  'f91acd03-6c64-0aca-b7a9-898eb14f5e08',
  'faf87d83-d25d-4a00-565a-1fa52b1a2e4b',
  'fd2d6aa1-a8a0-4c54-e344-bbee83f42fcd'
);

-- Verify: ~209 verified, each a distinct photograph.
select count(*) filter (where status = 'verified') as verified,
       count(*) filter (where status = 'rejected') as rejected
from training_images
where species_id = 'gulf_sturgeon';
