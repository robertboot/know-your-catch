/* ============================================================
   KNOW YOUR CATCH — Data tables
   ============================================================ */

// Regulations start as SEED VALUES and are overlaid by verified feed
// files from regulations/feed/ (see regulations/README.md). The app is
// offline-first: the bundled feed is the floor; a future runtime sync
// can refresh it. Seed values remain the fallback for anything the
// feed does not cover.

import gulfFederal2026 from '../regulations/feed/gulf-federal-2026.json';

export const JURISDICTIONS = [
  { id: 'al_state', name: 'Alabama State Waters', short: 'AL', agency: 'Alabama DCNR', boundary: '3 nm', regsUrl: 'https://www.outdooralabama.com/fishing/saltwater-fishing' },
  { id: 'fl_state', name: 'Florida Gulf State Waters', short: 'FL', agency: 'FWC', boundary: '9 nm', regsUrl: 'https://myfwc.com/fishing/saltwater/recreational/' },
  { id: 'ms_state', name: 'Mississippi State Waters', short: 'MS', agency: 'MDMR', boundary: '3 nm', regsUrl: 'https://dmr.ms.gov/' },
  { id: 'la_state', name: 'Louisiana State Waters', short: 'LA', agency: 'LDWF', boundary: '3 nm', regsUrl: 'https://www.wlf.louisiana.gov/' },
  { id: 'tx_state', name: 'Texas State Waters', short: 'TX', agency: 'TPWD', boundary: '9 nm', regsUrl: 'https://tpwd.texas.gov/regulations/outdoor-annual/fishing/saltwater-fishing' },
  { id: 'fed_gulf', name: 'Federal Gulf Waters', short: 'FED', agency: 'NOAA / GMFMC', boundary: 'Beyond state waters', regsUrl: 'https://www.fisheries.noaa.gov/southeast/recreational-fishing/recreational-fishing-gulf-mexico' },
];

export const CATEGORIES = [
  { id: 'snapper', name: 'Snapper' }, { id: 'grouper', name: 'Grouper' },
  { id: 'tilefish', name: 'Tilefish' },
  { id: 'jacks', name: 'Jacks' }, { id: 'mackerel', name: 'Mackerel' },
  { id: 'tuna', name: 'Tuna' }, { id: 'billfish', name: 'Billfish' },
  { id: 'trigger', name: 'Triggerfish' }, { id: 'sharks', name: 'Sharks' },
  { id: 'cobia', name: 'Cobia' }, { id: 'wahoo', name: 'Wahoo' },
  { id: 'reef', name: 'Reef Fish' },
];

export const SPECIES = [
  { id: 'red_snapper', commonName: 'Red Snapper', altNames: ['Sow Snapper', 'Genuine Red'], scientific: 'Lutjanus campechanus', category: 'snapper',
    keyIds: ['Pinkish-red body fading to pale belly', 'Distinctive red iris', 'Anal fin pointed and triangular', 'Sharp canine teeth', 'No dark spot on side in adults'],
    lookalikes: ['vermilion_snapper', 'lane_snapper', 'mutton_snapper'],
    habitat: 'Reefs, wrecks, ledges in 60–300 ft.', typicalSize: '15–30 in', reefFish: true },
  { id: 'vermilion_snapper', commonName: 'Vermilion Snapper', altNames: ['Beeliner', 'Mingo'], scientific: 'Rhomboplites aurorubens', category: 'snapper',
    keyIds: ['Slender vermilion-red body', 'Yellow diagonal lines below lateral line', 'Anal fin rounded (not pointed)', 'Smaller mouth than red snapper'],
    lookalikes: ['red_snapper', 'lane_snapper'],
    habitat: 'Offshore reefs and hard bottom, 80–300 ft.', typicalSize: '10–14 in', reefFish: true },
  { id: 'lane_snapper', commonName: 'Lane Snapper', altNames: ['Candy Snapper'], scientific: 'Lutjanus synagris', category: 'snapper',
    keyIds: ['Yellow horizontal stripes', 'Dark spot on side below dorsal (key feature)', 'Yellow tail and fins'],
    lookalikes: ['red_snapper', 'vermilion_snapper'],
    habitat: 'Coastal reefs and grass beds, 20–130 ft.', typicalSize: '8–14 in', reefFish: true },
  { id: 'mangrove_snapper', commonName: 'Gray Snapper', altNames: ['Mangrove Snapper', 'Black Snapper'], scientific: 'Lutjanus griseus', category: 'snapper',
    keyIds: ['Gray to greenish-gray body', 'Dark stripe through eye in juveniles', 'Prominent canine teeth', 'Reddish tint to fins'],
    lookalikes: ['mutton_snapper'],
    habitat: 'Mangroves, reefs, wrecks. Inshore to 300 ft.', typicalSize: '10–18 in', reefFish: true },
  { id: 'mutton_snapper', commonName: 'Mutton Snapper', altNames: [], scientific: 'Lutjanus analis', category: 'snapper',
    keyIds: ['Olive-green back, reddish sides', 'Small dark spot below dorsal', 'Blue stripes radiating from eye', 'Pointed anal fin'],
    lookalikes: ['mangrove_snapper', 'red_snapper'],
    habitat: 'Reefs and grass flats, 20–200 ft.', typicalSize: '15–25 in', reefFish: true },
  { id: 'yellowtail_snapper', commonName: 'Yellowtail Snapper', altNames: ['Flag'], scientific: 'Ocyurus chrysurus', category: 'snapper',
    keyIds: ['Bold yellow stripe from snout through tail', 'Deeply forked yellow tail', 'Yellow spots above lateral line'],
    lookalikes: [], habitat: 'Reefs in 30–180 ft.', typicalSize: '12–18 in', reefFish: true },
  { id: 'red_grouper', commonName: 'Red Grouper', altNames: [], scientific: 'Epinephelus morio', category: 'grouper',
    keyIds: ['Brownish-red with pale blotches', 'Second dorsal spine NOT elongated', 'Square tail margin', 'Black spots around eye'],
    lookalikes: ['gag_grouper', 'black_grouper', 'scamp'],
    habitat: 'Hard bottom and reefs, 30–400 ft.', typicalSize: '18–30 in', reefFish: true },
  { id: 'gag_grouper', commonName: 'Gag Grouper', altNames: ['Gag'], scientific: 'Mycteroperca microlepis', category: 'grouper',
    keyIds: ['Gray-brown with wavy "kiss-mark" markings', 'Tail concave with white margin', 'Second dorsal spine slightly elongated', 'No yellow on fin edges'],
    lookalikes: ['red_grouper', 'black_grouper', 'scamp'],
    habitat: 'Reefs, ledges, wrecks, 60–300 ft.', typicalSize: '20–36 in', reefFish: true },
  { id: 'black_grouper', commonName: 'Black Grouper', altNames: [], scientific: 'Mycteroperca bonaci', category: 'grouper',
    keyIds: ['Dark olive-gray with rectangular blotches', 'Pectoral fins with broad orange edge', 'Tail concave with thin white margin'],
    lookalikes: ['gag_grouper', 'red_grouper'],
    habitat: 'Reefs and ledges, 60–250 ft.', typicalSize: '20–40 in', reefFish: true },
  { id: 'scamp', commonName: 'Scamp', altNames: ['Scamp Grouper'], scientific: 'Mycteroperca phenax', category: 'grouper',
    keyIds: ['Light tan with small dark spots', 'Caudal rays extended ("broomtail")', 'Yellow corners on mouth'],
    lookalikes: ['gag_grouper', 'red_grouper'],
    habitat: 'Deep reefs, 100–500 ft.', typicalSize: '15–24 in', reefFish: true },
  { id: 'greater_amberjack', commonName: 'Greater Amberjack', altNames: ['AJ', 'Reef Donkey'], scientific: 'Seriola dumerili', category: 'jacks',
    keyIds: ['Dark amber stripe through eye to first dorsal', 'Amber stripe along flank', 'More elongate than almaco jack'],
    lookalikes: ['lesser_amberjack', 'almaco_jack', 'banded_rudderfish'],
    habitat: 'Reefs, wrecks, oil rigs, 60–300 ft.', typicalSize: '30–50 in', reefFish: true },
  { id: 'lesser_amberjack', commonName: 'Lesser Amberjack', altNames: [], scientific: 'Seriola fasciata', category: 'jacks',
    keyIds: ['Eye stripe ends BEFORE first dorsal', 'Larger eye proportional to head', 'Rarely exceeds 10 lb'],
    lookalikes: ['greater_amberjack', 'almaco_jack', 'banded_rudderfish'],
    habitat: 'Deep reefs, 100–400 ft.', typicalSize: '10–18 in', reefFish: true },
  { id: 'almaco_jack', commonName: 'Almaco Jack', altNames: [], scientific: 'Seriola rivoliana', category: 'jacks',
    keyIds: ['Body deeper and more compressed', 'Dorsal and anal fins tall (sickle-shaped)', 'Darker overall color'],
    lookalikes: ['greater_amberjack', 'lesser_amberjack'],
    habitat: 'Offshore reefs and rigs, 100–400 ft.', typicalSize: '20–36 in', reefFish: true },
  { id: 'banded_rudderfish', commonName: 'Banded Rudderfish', altNames: ['Rudderfish'], scientific: 'Seriola zonata', category: 'jacks',
    keyIds: ['Juveniles show 6 dark vertical bands', 'Adults lose bands, look like small amberjack', 'Rarely over 10 lb'],
    lookalikes: ['greater_amberjack', 'lesser_amberjack', 'almaco_jack'],
    habitat: 'Reefs and floating debris, 30–250 ft.', typicalSize: '12–24 in', reefFish: true },
  { id: 'spanish_mackerel', commonName: 'Spanish Mackerel', altNames: ['Spanish'], scientific: 'Scomberomorus maculatus', category: 'mackerel',
    keyIds: ['Lateral line slopes gently — no sharp dip', 'Front of first dorsal is BLACK', 'Yellow/golden oval spots on sides', 'Smaller mouth than king mackerel'],
    lookalikes: ['king_mackerel', 'cero_mackerel'],
    habitat: 'Coastal waters to 100 ft.', typicalSize: '14–22 in' },
  { id: 'king_mackerel', commonName: 'King Mackerel', altNames: ['Kingfish', 'King'], scientific: 'Scomberomorus cavalla', category: 'mackerel',
    keyIds: ['Lateral line DIPS SHARPLY below second dorsal', 'First dorsal entirely gray (no black)', 'No spots on adults', 'Large mouth'],
    lookalikes: ['spanish_mackerel', 'cero_mackerel'],
    habitat: 'Coastal to offshore, 30–200 ft.', typicalSize: '20–40 in' },
  { id: 'cero_mackerel', commonName: 'Cero Mackerel', altNames: ['Cero'], scientific: 'Scomberomorus regalis', category: 'mackerel',
    keyIds: ['Bronze stripe along midline', 'Yellow spots above and below stripe', 'Black patch on first dorsal'],
    lookalikes: ['spanish_mackerel', 'king_mackerel'],
    habitat: 'Reefs and structure, 30–80 ft.', typicalSize: '12–20 in' },
  { id: 'yellowfin_tuna', commonName: 'Yellowfin Tuna', altNames: ['Ahi'], scientific: 'Thunnus albacares', category: 'tuna',
    keyIds: ['Long bright yellow second dorsal and anal fins', 'Yellow finlets with black edges', 'Golden-yellow side stripe'],
    lookalikes: ['blackfin_tuna'],
    habitat: 'Offshore blue water.', typicalSize: '40–80 in', hms: true },
  { id: 'blackfin_tuna', commonName: 'Blackfin Tuna', altNames: [], scientific: 'Thunnus atlanticus', category: 'tuna',
    keyIds: ['Dark dusky finlets (NOT yellow)', 'Smaller than yellowfin — rarely over 40 lb', 'Bronze tint to body'],
    lookalikes: ['yellowfin_tuna'],
    habitat: 'Offshore, near rigs and shelf edges.', typicalSize: '20–28 in', hms: true },
  { id: 'blue_marlin', commonName: 'Blue Marlin', altNames: [], scientific: 'Makaira nigricans', category: 'billfish',
    keyIds: ['Cobalt blue back, silvery-white belly', 'First dorsal pointed, lower than body depth', 'Round bill in cross-section'],
    lookalikes: ['white_marlin', 'sailfish'],
    habitat: 'Blue water offshore.', typicalSize: '80–150 in', hms: true },
  { id: 'sailfish', commonName: 'Atlantic Sailfish', altNames: ['Sail'], scientific: 'Istiophorus albicans', category: 'billfish',
    keyIds: ['Huge sail-like first dorsal, taller than body', 'Dark blue back with vertical light blue bars', 'Slender body'],
    lookalikes: ['blue_marlin', 'white_marlin'],
    habitat: 'Offshore blue water.', typicalSize: '60–80 in', hms: true },
  { id: 'white_marlin', commonName: 'White Marlin', altNames: [], scientific: 'Kajikia albida', category: 'billfish',
    keyIds: ['First dorsal ROUNDED at tip', 'Pectoral and anal fins also rounded', 'Smaller than blue marlin'],
    lookalikes: ['blue_marlin', 'sailfish'],
    habitat: 'Offshore blue water.', typicalSize: '60–80 in', hms: true },
  { id: 'gray_triggerfish', commonName: 'Gray Triggerfish', altNames: ['Trigger'], scientific: 'Balistes capriscus', category: 'trigger',
    keyIds: ['Compressed diamond-shaped body', 'First dorsal has 3 stout spines', 'Mottled gray-brown'],
    lookalikes: [], habitat: 'Reefs, wrecks, hard bottom, 60–300 ft.', typicalSize: '12–18 in', reefFish: true },
  { id: 'blacktip_shark', commonName: 'Blacktip Shark', altNames: [], scientific: 'Carcharhinus limbatus', category: 'sharks',
    keyIds: ['Black tips on pectoral, dorsal, and lower caudal fins', 'Anal fin tip is NOT black', 'Slender streamlined body'],
    lookalikes: [], habitat: 'Coastal waters, near beaches and bays.', typicalSize: '48–60 in', hms: true },
  { id: 'cobia', commonName: 'Cobia', altNames: ['Ling', 'Lemonfish'], scientific: 'Rachycentron canadum', category: 'cobia',
    keyIds: ['Long torpedo-shaped body', 'Dark brown back, white belly', 'Lateral dark stripe', 'Broad flat head'],
    lookalikes: [], habitat: 'Coastal and offshore, around buoys, rigs, rays, floating debris.', typicalSize: '30–50 in' },
  { id: 'wahoo', commonName: 'Wahoo', altNames: ['Ono'], scientific: 'Acanthocybium solandri', category: 'wahoo',
    keyIds: ['Long slender torpedo body', 'Bright vertical blue bars on sides', 'Razor-sharp teeth', 'Long pointed snout'],
    lookalikes: ['king_mackerel'],
    habitat: 'Offshore blue water, near current edges and rigs.', typicalSize: '40–60 in' },
  { id: 'mahi', commonName: 'Mahi-Mahi', altNames: ['Dolphinfish', 'Dolphin', 'Dorado'], scientific: 'Coryphaena hippurus', category: 'reef',
    keyIds: ['Brilliant green, blue, and gold coloration', 'Adult males: steep blunt forehead', 'Long continuous dorsal fin', 'Deeply forked tail'],
    lookalikes: [], habitat: 'Offshore, under floating debris, weed lines, sargassum.', typicalSize: '20–40 in' },
  { id: 'golden_tilefish', commonName: 'Golden Tilefish', altNames: ['Tilefish', 'Golden Tile'], scientific: 'Lopholatilus chamaeleonticeps', category: 'tilefish',
    keyIds: ['Blue-green back fading to yellow then white belly', 'Bright yellow spots scattered over the body', 'Fleshy crest (adipose flap) on top of the head', 'Large blunt head; deep clay-bottom fish'],
    lookalikes: ['blueline_tilefish'], habitat: 'Deep clay and mud bottoms with burrows, 250–1,500 ft.', typicalSize: '20–40 in', reefFish: true },
  { id: 'blueline_tilefish', commonName: 'Blueline Tilefish', altNames: ['Gray Tilefish', 'Blueline Tile'], scientific: 'Caulolatilus microps', category: 'tilefish',
    keyIds: ['Blue line running just beneath the eye', 'Pale gray to olive body with a gold midline', 'No fleshy crest on the head (unlike golden tilefish)', 'Deep rocky and rubble bottoms'],
    lookalikes: ['golden_tilefish'], habitat: 'Deep rocky and rubble bottoms, 250–800 ft.', typicalSize: '15–30 in', reefFish: true },
  { id: 'short_bigeye', commonName: 'Short Bigeye', altNames: ['Toro', 'Big Eye Toro', 'Bigeye'], scientific: 'Pristigenys alta', category: 'reef',
    keyIds: ['Bright red to rosy body', 'Very large eye', 'Deep, oval, strongly compressed body', 'Rough scales; single continuous spiny dorsal fin'],
    lookalikes: [], habitat: 'Reefs, rocky ledges and drop-offs, 50–600 ft.', typicalSize: '6–12 in' },
];

export const COMPARISONS = {
  'red_snapper:vermilion_snapper': [
    { feature: 'Anal fin shape', a: 'Pointed, triangular', b: 'Rounded' },
    { feature: 'Body proportions', a: 'Deeper, stockier', b: 'Slender, elongate' },
    { feature: 'Eye color', a: 'Red iris (distinctive)', b: 'Not red' },
    { feature: 'Side markings', a: 'Solid red, no stripes', b: 'Yellow diagonal lines below lateral line' },
    { feature: 'Mouth', a: 'Larger, prominent canines', b: 'Smaller mouth' },
  ],
  'lane_snapper:red_snapper': [
    { feature: 'Dark spot on side', a: 'Present, below dorsal', b: 'Absent in adults' },
    { feature: 'Body stripes', a: 'Yellow horizontal stripes', b: 'No stripes — solid red' },
    { feature: 'Tail color', a: 'Yellow tail and fins', b: 'Red/pink tail' },
    { feature: 'Adult size', a: 'Small — usually under 15 in', b: 'Large — often 18+ in' },
  ],
  'lane_snapper:vermilion_snapper': [
    { feature: 'Dark spot on side', a: 'Present, prominent', b: 'Absent' },
    { feature: 'Side markings', a: 'Yellow horizontal stripes', b: 'Yellow diagonal lines' },
    { feature: 'Habitat depth', a: 'Shallower (20–130 ft)', b: 'Deeper (80–300 ft)' },
  ],
  'mangrove_snapper:mutton_snapper': [
    { feature: 'Body color', a: 'Gray to gray-green', b: 'Olive-green with reddish sides' },
    { feature: 'Spot on side', a: 'No dark spot', b: 'Small dark spot below dorsal' },
    { feature: 'Face markings', a: 'Dark eye stripe (juveniles)', b: 'Blue stripes radiating from eye' },
    { feature: 'Anal fin', a: 'Rounded', b: 'Pointed' },
  ],
  'mutton_snapper:red_snapper': [
    { feature: 'Spot on side', a: 'Small dark spot present', b: 'Absent in adults' },
    { feature: 'Face markings', a: 'Blue stripes from eye', b: 'No blue stripes' },
    { feature: 'Body color', a: 'Olive back, reddish sides', b: 'Solid pinkish-red' },
  ],
  'gag_grouper:red_grouper': [
    { feature: 'Tail margin', a: 'Concave with white margin', b: 'Square (straight) margin' },
    { feature: 'Body markings', a: 'Wavy "kiss-mark" blotches', b: 'Pale blotches, no kiss marks' },
    { feature: 'Black spots around eye', a: 'No prominent spots', b: 'Black spots present' },
    { feature: 'Second dorsal spine', a: 'Slightly elongated', b: 'Straight, not elongated' },
  ],
  'black_grouper:gag_grouper': [
    { feature: 'Pectoral fin edge', a: 'Broad orange edge', b: 'No orange edge' },
    { feature: 'Body markings', a: 'Rectangular dark blotches', b: 'Wavy kiss-mark blotches' },
    { feature: 'Average size', a: 'Often larger (up to 40+ in)', b: '20–36 in typical' },
  ],
  'black_grouper:red_grouper': [
    { feature: 'Pectoral fin edge', a: 'Broad orange edge', b: 'No orange edge' },
    { feature: 'Tail margin', a: 'Concave with white margin', b: 'Square margin' },
    { feature: 'Body color', a: 'Dark olive-gray', b: 'Brownish-red' },
  ],
  'gag_grouper:scamp': [
    { feature: 'Tail rays', a: 'Concave, no extended rays', b: 'Caudal rays extended ("broomtail")' },
    { feature: 'Mouth corners', a: 'No yellow', b: 'Yellow at corners of mouth' },
    { feature: 'Body markings', a: 'Wavy kiss marks', b: 'Small dark spots on tan body' },
  ],
  'red_grouper:scamp': [
    { feature: 'Tail rays', a: 'Square margin', b: '"Broomtail" — extended rays' },
    { feature: 'Body color', a: 'Brownish-red, pale blotches', b: 'Light tan with small dark spots' },
    { feature: 'Mouth corners', a: 'No yellow', b: 'Yellow at corners' },
  ],
  'greater_amberjack:lesser_amberjack': [
    { feature: 'Eye stripe', a: 'Extends back TO first dorsal', b: 'Ends BEFORE first dorsal' },
    { feature: 'Eye size proportion', a: 'Smaller relative to head', b: 'Larger relative to head' },
    { feature: 'Adult size', a: 'Large — 30–60+ in', b: 'Small — rarely over 18 in' },
  ],
  'almaco_jack:greater_amberjack': [
    { feature: 'Body depth', a: 'Deeper, more compressed', b: 'More elongate, torpedo-like' },
    { feature: 'Dorsal/anal fin shape', a: 'Tall, sickle-shaped lobes', b: 'Lower lobes' },
    { feature: 'Eye stripe', a: 'Present but often faint', b: 'Dark, prominent, to first dorsal' },
    { feature: 'Body color', a: 'Darker overall', b: 'Lighter with amber band' },
  ],
  'almaco_jack:lesser_amberjack': [
    { feature: 'Body depth', a: 'Deep, compressed', b: 'More elongate' },
    { feature: 'Adult size', a: '20–36 in typical', b: 'Small — rarely over 18 in' },
  ],
  'banded_rudderfish:greater_amberjack': [
    { feature: 'Vertical bands (juveniles)', a: '6 dark vertical bands', b: 'No vertical bands' },
    { feature: 'Adult size', a: 'Small — rarely over 10 lb', b: 'Large — often 20+ lb' },
  ],
  'banded_rudderfish:lesser_amberjack': [
    { feature: 'Vertical bands (juveniles)', a: 'Present', b: 'Absent' },
    { feature: 'Eye proportion', a: 'Normal', b: 'Large relative to head' },
  ],
  'banded_rudderfish:almaco_jack': [
    { feature: 'Body shape', a: 'Elongate', b: 'Deep, compressed' },
    { feature: 'Vertical bands', a: 'Present in juveniles', b: 'Absent' },
  ],
  'king_mackerel:spanish_mackerel': [
    { feature: 'Lateral line', a: 'Dips SHARPLY below second dorsal', b: 'Slopes gently' },
    { feature: 'Front of first dorsal', a: 'Entirely gray', b: 'Black patch on front' },
    { feature: 'Spots on side', a: 'No spots in adults; juveniles may have faint', b: 'Yellow/golden oval spots prominent' },
    { feature: 'Mouth size', a: 'Large mouth, larger teeth', b: 'Smaller mouth' },
    { feature: 'Adult size', a: 'Often 20+ lb', b: 'Usually under 8 lb' },
  ],
  'cero_mackerel:spanish_mackerel': [
    { feature: 'Bronze stripe along midline', a: 'Present', b: 'Absent' },
    { feature: 'Spots vs. stripes', a: 'Yellow spots ABOVE and BELOW stripe', b: 'Spots only, no stripe' },
  ],
  'cero_mackerel:king_mackerel': [
    { feature: 'Lateral line', a: 'Slopes gently', b: 'Dips sharply' },
    { feature: 'Bronze stripe along side', a: 'Present', b: 'Absent' },
    { feature: 'Black patch on first dorsal', a: 'Present', b: 'Absent' },
  ],
  'blackfin_tuna:yellowfin_tuna': [
    { feature: 'Finlet color', a: 'Dark/dusky', b: 'Bright yellow with black edges' },
    { feature: 'Second dorsal and anal fins', a: 'Short, not elongated', b: 'Long, bright yellow' },
    { feature: 'Side stripe', a: 'Bronze tint, no bright stripe', b: 'Golden-yellow stripe' },
    { feature: 'Adult size', a: 'Rarely over 40 lb', b: 'Often 50+ lb' },
  ],
  'blue_marlin:white_marlin': [
    { feature: 'First dorsal tip', a: 'Pointed', b: 'Rounded' },
    { feature: 'Pectoral and anal fin tips', a: 'Pointed', b: 'Rounded' },
    { feature: 'Spots on fins', a: 'Generally absent', b: 'Often visible spots on fins' },
    { feature: 'Body size', a: 'Larger — often 200+ lb', b: 'Smaller — usually under 100 lb' },
  ],
  'blue_marlin:sailfish': [
    { feature: 'First dorsal fin', a: 'Pointed, lower than body depth', b: 'Huge sail, taller than body' },
    { feature: 'Body build', a: 'Heavy, robust', b: 'Slender' },
  ],
  'sailfish:white_marlin': [
    { feature: 'First dorsal fin', a: 'Huge sail, taller than body', b: 'Rounded lobe, shorter than body' },
    { feature: 'Body build', a: 'Slender', b: 'Slightly heavier' },
  ],
  'king_mackerel:wahoo': [
    { feature: 'Vertical bars on sides', a: 'No vertical bars', b: 'Bright blue vertical bars' },
    { feature: 'Snout', a: 'Shorter', b: 'Long, pointed' },
    { feature: 'Body proportion', a: 'Elongate but less so', b: 'Very elongate, torpedo-like' },
  ],
  'golden_tilefish:blueline_tilefish': [
    { feature: 'Head crest', a: 'Prominent fleshy crest/flap on top of head', b: 'No crest on head' },
    { feature: 'Eye marking', a: 'No blue line at the eye', b: 'Distinct blue line beneath the eye' },
    { feature: 'Color', a: 'Blue-green with bright yellow spots', b: 'Plain gray to olive, gold midline' },
    { feature: 'Size', a: 'Larger — to 40+ in', b: 'Smaller — 15–30 in' },
  ],
};

// Build regulations programmatically to save space
function buildRegs() {
  const reefGear = ['Non-stainless circle hooks (natural bait)', 'Descending device (rigged, 16+ oz)', 'Venting tool (rigged)'];
  const states = ['al_state','fl_state','ms_state','la_state','tx_state','fed_gulf'];
  function R(spec) {
    const out = {};
    for (const s of states) {
      // Baseline provenance first so a per-jurisdiction override can supply
      // its own verified values, source and date.
      out[s] = {
        lastUpdated: '2025-04-01',
        source: spec.source || 'agency website',
        verified: false,
        ...spec.default,
        ...(spec[s] || {}),
      };
    }
    return out;
  }
  return {
    red_snapper: R({
      default: { open: 'Check current season', minSize: 16, bagLimit: 2, gear: reefGear, notes: 'Federal seasons differ by sector. Most Gulf states manage private rec under delegated authority.' },
      la_state: { bagLimit: 4, notes: 'Louisiana ROLP required. Higher bag limit than other Gulf states.' },
      tx_state: { open: 'Year-round in state waters', minSize: 15, bagLimit: 4, notes: 'Texas state waters allow year-round red snapper.' },
      al_state: {
        open: 'Opens May 22, 2026 — 7 days/week (private rec, quota-managed)',
        minSize: 16, bagLimit: 2,
        notes: '16 in total length minimum. Reef Fish Endorsement required to land. Mandatory Snapper Check report before landing. Private-angler quota: 664,552 lb.',
        source: 'outdooralabama.com', lastUpdated: '2026-05-15', verified: true,
      },
      fed_gulf: { sectors: { 'Private rec': 'Limited federal season — varies by state delegation', 'For-hire / charter': 'Separate for-hire federal season' } },
      source: 'fisheries.noaa.gov',
    }),
    vermilion_snapper: R({ default: { open: 'Year-round', minSize: 10, bagLimit: 10, gear: reefGear, notes: 'Part of reef fish aggregate.' }, source: 'fisheries.noaa.gov' }),
    lane_snapper: R({
      default: { open: 'Year-round', minSize: 8, bagLimit: 100, notes: 'No specific bag — part of reef fish aggregate.' },
      tx_state: { bagLimit: 25 },
      source: 'fisheries.noaa.gov',
    }),
    mangrove_snapper: R({
      default: { open: 'Year-round', minSize: 12, bagLimit: 10 },
      fl_state: { minSize: 10, bagLimit: 5 },
      tx_state: { bagLimit: 5 },
      source: 'fisheries.noaa.gov',
    }),
    mutton_snapper: R({
      default: { open: 'Year-round', minSize: 18, bagLimit: 5 },
      tx_state: { minSize: 16 },
      source: 'fisheries.noaa.gov',
    }),
    yellowtail_snapper: R({ default: { open: 'Year-round', minSize: 12, bagLimit: 10 }, source: 'fisheries.noaa.gov' }),
    red_grouper: R({
      default: { open: 'Year-round (verify)', minSize: 20, bagLimit: 2, gear: reefGear, notes: 'Part of grouper aggregate.' },
      fl_state: { open: 'Open Jan 1 – Dec 3 (verify)' },
      ms_state: { bagLimit: 4 },
      la_state: { minSize: 18, bagLimit: 4 },
      tx_state: { minSize: 18, bagLimit: 4 },
      source: 'fisheries.noaa.gov',
    }),
    gag_grouper: R({
      default: { open: 'June 1 – Oct 31 (verify)', minSize: 24, bagLimit: 2, gear: reefGear },
      al_state: {
        open: 'Sept 1 – Dec 31 (closed Jan 1 – Aug 31, 2026)',
        notes: 'Recreational season closed Jan 1 – Aug 31, 2026; reopens Sept 1.',
        source: 'outdooralabama.com', lastUpdated: '2026-05-15', verified: true,
      },
      fl_state: { open: 'Sept 1 – Nov 10 (verify)', notes: 'FL Gulf gag season restricted in recent years. Verify before fishing.' },
      la_state: { minSize: 22 },
      tx_state: { open: 'Year-round (verify)', minSize: 22, bagLimit: 4 },
      fed_gulf: { open: 'Sept 1 – Oct 31 typical (verify)' },
      source: 'fisheries.noaa.gov',
    }),
    black_grouper: R({
      default: { open: 'Year-round (verify)', minSize: 24, bagLimit: 2, gear: reefGear },
      fl_state: { open: 'May 1 – Dec 31 (verify)' },
      la_state: { minSize: 22 },
      tx_state: { bagLimit: 4 },
      fed_gulf: { open: 'May 1 – Dec 31 (verify)' },
      source: 'fisheries.noaa.gov',
    }),
    scamp: R({
      default: { open: 'Year-round (verify)', minSize: 16, bagLimit: 2, gear: reefGear, notes: 'Part of grouper aggregate.' },
      tx_state: { bagLimit: 4 },
      source: 'fisheries.noaa.gov',
    }),
    greater_amberjack: R({
      default: { open: 'Verify season — heavily restricted', minSize: 34, bagLimit: 1, gear: reefGear, notes: 'Often closed by emergency action.' },
      al_state: {
        open: 'Sept 1 – Dec 31 (closed Jan 1 – Aug 31, 2026)',
        notes: 'Recreational closures Jan 1 – Jul 31 and Aug 1 – Aug 31, 2026. Mandatory Snapper Check report before landing.',
        source: 'outdooralabama.com', lastUpdated: '2026-05-15', verified: true,
      },
      fl_state: { open: 'Closed — limited season, verify', notes: 'Greater amberjack has been closed or very limited in FL Gulf.' },
      tx_state: { open: 'Year-round (verify)' },
      fed_gulf: { open: 'Sept 1 – Oct 31 typical (verify)' },
      source: 'fisheries.noaa.gov',
    }),
    lesser_amberjack: R({
      default: { open: 'Year-round', minSize: 14, maxSize: 22, bagLimit: 5, gear: ['Non-stainless circle hooks', 'Descending device', 'Venting tool'], notes: 'Slot limit 14–22 in. Aggregate with banded rudderfish.' },
      source: 'fisheries.noaa.gov',
    }),
    almaco_jack: R({ default: { open: 'Year-round', minSize: null, bagLimit: 20, notes: 'Part of reef fish aggregate.' }, source: 'fisheries.noaa.gov' }),
    banded_rudderfish: R({
      default: { open: 'Year-round', minSize: 14, maxSize: 22, bagLimit: 5, notes: 'Slot limit. Aggregate with lesser amberjack.' },
      source: 'fisheries.noaa.gov',
    }),
    spanish_mackerel: R({
      default: { open: 'Year-round', minSize: 14, bagLimit: 15 },
      fl_state: { minSize: 12 },
      fed_gulf: { minSize: 12 },
      source: 'fisheries.noaa.gov',
    }),
    king_mackerel: R({
      default: { open: 'Year-round', minSize: 24, bagLimit: 3, notes: 'Fork length.' },
      fl_state: { bagLimit: 2 },
      la_state: { bagLimit: 2 },
      tx_state: { minSize: 27 },
      source: 'fisheries.noaa.gov',
    }),
    cero_mackerel: R({ default: { open: 'Year-round', minSize: 12, bagLimit: 15 }, source: 'fisheries.noaa.gov' }),
    yellowfin_tuna: R({
      default: { open: 'Year-round', minSize: 27, bagLimit: 3, hms: true, notes: 'Federal Atlantic HMS permit required. Curved fork length.' },
      source: 'fisheries.noaa.gov',
    }),
    blackfin_tuna: R({
      default: { open: 'Year-round', minSize: null, bagLimit: null, hms: true, notes: 'HMS permit required. No federal size/bag.' },
      fl_state: { bagLimit: 2, notes: 'Florida 2/day limit. HMS permit required.' },
      source: 'fisheries.noaa.gov',
    }),
    blue_marlin: R({
      default: { open: 'Year-round', minSize: 99, bagLimit: 1, hms: true, notes: 'Lower jaw fork length. HMS permit required. Combined billfish landings limit applies.' },
      source: 'fisheries.noaa.gov',
    }),
    sailfish: R({
      default: { open: 'Year-round', minSize: 63, bagLimit: 1, hms: true, notes: 'Lower jaw fork length. HMS permit required.' },
      source: 'fisheries.noaa.gov',
    }),
    white_marlin: R({
      default: { open: 'Year-round', minSize: 66, bagLimit: 1, hms: true, notes: 'Lower jaw fork length. HMS permit required.' },
      source: 'fisheries.noaa.gov',
    }),
    gray_triggerfish: R({
      default: { open: 'Year-round (verify)', minSize: 15, bagLimit: 1, gear: reefGear },
      fl_state: { open: 'Mar 1 – May 31, Aug 1 – Dec 31 (verify)' },
      fed_gulf: { open: 'Limited season (verify)', notes: 'Federal seasonal closure typical in mid-summer.' },
      source: 'fisheries.noaa.gov',
    }),
    blacktip_shark: R({
      default: { open: 'Year-round', minSize: 54, bagLimit: 1, hms: true, notes: 'HMS permit required. One shark per vessel per day.' },
      tx_state: { minSize: 64 },
      source: 'fisheries.noaa.gov',
    }),
    cobia: R({
      default: { open: 'Year-round', minSize: 36, bagLimit: 1, vesselLimit: 2 },
      fl_state: { notes: 'Fork length. Vessel limit reduced from 6 in recent years.' },
      tx_state: { minSize: 40, bagLimit: 3 },
      source: 'fisheries.noaa.gov',
    }),
    wahoo: R({ default: { open: 'Year-round', minSize: null, bagLimit: 2 }, source: 'fisheries.noaa.gov' }),
    mahi: R({
      default: { open: 'Year-round', minSize: null, bagLimit: 10, vesselLimit: 60 },
      fl_state: { minSize: 20, bagLimit: 5, vesselLimit: 30, notes: 'Fork length.' },
      tx_state: { vesselLimit: null },
      source: 'fisheries.noaa.gov',
    }),
    golden_tilefish: R({
      default: { open: 'Check current season', minSize: null, bagLimit: null, gear: reefGear, notes: 'Gulf reef fish — managed in the deep-water grouper/tilefish complex; aggregate limits and seasonal closures may apply. No fixed rec size limit on file. Verify with the agency.' },
      source: 'fisheries.noaa.gov',
    }),
    blueline_tilefish: R({
      default: { open: 'Check current season', minSize: null, bagLimit: null, gear: reefGear, notes: 'Gulf reef fish — managed in the deep-water grouper/tilefish complex; aggregate limits and seasonal closures may apply. No fixed rec size limit on file. Verify with the agency.' },
      source: 'fisheries.noaa.gov',
    }),
    short_bigeye: R({
      default: { open: 'Check current season', minSize: null, bagLimit: null, notes: 'No species-specific recreational size or bag limit on file. Verify with the agency before keeping.' },
      source: 'fisheries.noaa.gov',
    }),
  };
}
// Overlay a verified feed file onto the seed for one jurisdiction.
// Feed values win; anything the feed omits keeps its seed value
// (e.g. required-gear lists for reef species).
export function applyFeed(regs, feed) {
  if (!feed || feed.schema !== 'kyc-regulations/v1' || !feed.rules) return;
  const jur = feed.jurisdiction;
  for (const [sid, rule] of Object.entries(feed.rules || {})) {
    if (!regs[sid]) regs[sid] = {};
    regs[sid][jur] = {
      ...(regs[sid][jur] || {}),
      open: rule.open,
      minSize: rule.minSize,
      maxSize: rule.maxSize,
      bagLimit: rule.bagLimit,
      vesselLimit: rule.vesselLimit,
      lengthType: rule.lengthType,
      notes: rule.notes,
      source: rule.source,
      lastUpdated: rule.lastUpdated,
      verified: rule.verified,
      confidence: rule.confidence,
    };
  }
}

export const REGULATIONS = buildRegs();
applyFeed(REGULATIONS, gulfFederal2026);

// Offline-first overlay: a feed cached by a previous runtime sync wins
// over the bundled one. Any failure keeps the bundled data.
try {
  if (typeof localStorage !== 'undefined') {
    const cached = JSON.parse(localStorage.getItem('kyc_regs_feed_v1') || 'null');
    if (cached && cached.files) {
      for (const f of Object.values(cached.files)) applyFeed(REGULATIONS, f);
    }
  }
} catch (e) { /* keep bundled data */ }

export const FEEDS = [
  { file: 'gulf-federal-2026.json', jurisdiction: gulfFederal2026.jurisdiction, verifiedDate: gulfFederal2026.verifiedDate },
];

export const DATA_VERSION = '1.0.0-seed';
export const DATA_BUILD_DATE = '2025-04-01';
export const DISCLAIMER_VERSION = 1;
export const DISCLAIMER_TEXT = `This app is intended as an informational tool only. Fishing regulations change frequently — often without notice — and may differ from what is shown here. You are responsible for verifying current regulations with the appropriate state or federal agency before harvesting any fish. The publisher accepts no liability for citations, fines, or other consequences arising from reliance on the information provided. Use this app as a starting point. Verify everything.`;
