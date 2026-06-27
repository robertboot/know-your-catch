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
  { id: 'cod', name: 'Cod' },
  { id: 'sturgeon', name: 'Sturgeon' },
  { id: 'bait', name: 'Bait Fish' },
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
  { id: 'bigeye_tuna', commonName: 'Bigeye Tuna', altNames: ['Ahi'], scientific: 'Thunnus obesus', category: 'tuna',
    keyIds: ['Very large eye relative to head', 'Pectoral fins reach past second dorsal in juveniles', 'Yellow finlets edged in black (similar to yellowfin)', 'Deeper, more rounded body than yellowfin'],
    lookalikes: ['yellowfin_tuna'],
    habitat: 'Deep offshore blue water, cooler thermocline depths.', typicalSize: '40–80 in', hms: true },
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
  { id: 'atlantic_cod', commonName: 'Atlantic Cod', altNames: ['Cod'], scientific: 'Gadus morhua', category: 'cod',
    keyIds: ['Chin barbel (single whisker under the jaw)', 'Three dorsal fins and two anal fins (gadoid arrangement)', 'Mottled brown / gray / olive with pale belly', 'Pale, curved lateral line'],
    lookalikes: [],
    habitat: 'Cold North Atlantic — rocky and gravel bottoms, 30–600 ft. Not a Gulf of America species.', typicalSize: '20–48 in' },
  { id: 'goliath_grouper', commonName: 'Goliath Grouper', altNames: ['Jewfish (former name)'], scientific: 'Epinephelus itajara', category: 'grouper',
    keyIds: ['Massive size — adults often exceed 400 lb', 'Brown-yellow to gray-green with small dark spots', 'Five irregular dark bars across body (clearer in juveniles)', 'Broadly rounded tail, small eyes', 'Often found near structure — wrecks, rigs, ledges'],
    lookalikes: [],
    habitat: 'Shallow reefs, mangroves, wrecks, oil rigs, 5–150 ft.', typicalSize: '50–96 in', reefFish: true },
  { id: 'atlantic_mackerel', commonName: 'Atlantic Mackerel', altNames: ['Boston Mackerel'], scientific: 'Scomber scombrus', category: 'mackerel',
    keyIds: ['Steel-blue/green back with dark wavy bars or lines', 'Silvery sides, no spots', 'Series of small finlets behind dorsal and anal fins', 'Deeply forked tail', 'Smaller and more slender than king or Spanish mackerel'],
    lookalikes: ['spanish_mackerel'],
    habitat: 'Northwest Atlantic, coastal to offshore. Not a Gulf of America species.', typicalSize: '12–18 in' },
  { id: 'atlantic_menhaden', commonName: 'Atlantic Menhaden', altNames: ['Bunker', 'Pogy', 'Mossbunker'], scientific: 'Brevoortia tyrannus', category: 'bait',
    keyIds: ['Deep, laterally compressed body', 'Sharp scutes along the belly (saw-edged)', 'Large dark shoulder spot followed by smaller spots along the side', 'Silvery with bluish-green back', 'Large head, no teeth'],
    lookalikes: [],
    habitat: 'Atlantic coast estuaries and nearshore waters; schools heavily in summer.', typicalSize: '6–12 in' },
  { id: 'atlantic_sharpnose_shark', commonName: 'Atlantic Sharpnose Shark', altNames: ['Sharpnose'], scientific: 'Rhizoprionodon terraenovae', category: 'sharks',
    keyIds: ['Slender body with long pointed snout', 'Brown to olive-gray, often with scattered small white spots on sides', 'Second dorsal fin originates over the middle of the anal fin (key feature)', 'Labial furrows long and obvious', 'Smaller — rarely over 4 ft'],
    lookalikes: ['blacktip_shark'],
    habitat: 'Coastal Gulf and Atlantic waters, shallow to 200 ft. Common around piers and beaches.', typicalSize: '30–42 in', hms: true },
  { id: 'shortfin_mako_shark', commonName: 'Shortfin Mako Shark', altNames: ['Mako', 'Bonito Shark'], scientific: 'Isurus oxyrinchus', category: 'sharks',
    keyIds: ['Streamlined fusiform body — built for speed', 'Bright metallic blue back fading to silvery-white belly', 'Pointed conical snout', 'Long, curved, visible teeth (even when mouth is closed)', 'Crescent-shaped tail with strong keel at base'],
    lookalikes: ['blacktip_shark'],
    habitat: 'Offshore pelagic, surface to 500 ft. Atlantic and Gulf blue water.', typicalSize: '60–130 in', hms: true },
  { id: 'atlantic_sturgeon', commonName: 'Atlantic Sturgeon', altNames: [], scientific: 'Acipenser oxyrinchus oxyrinchus', category: 'sturgeon',
    keyIds: ['Five rows of bony plates (scutes) along the body', 'Long pointed snout with four barbels in front of the mouth', 'Heterocercal (shark-like) tail with upper lobe much longer', 'Olive-brown back fading to pale belly', 'No scales — armored with scutes instead'],
    lookalikes: [],
    habitat: 'Anadromous — Atlantic coast rivers, estuaries, and nearshore ocean. Federally endangered. Not a Gulf of America species.', typicalSize: '60–120 in' },
  { id: 'black_sea_bass', commonName: 'Black Sea Bass', altNames: ['Sea Bass'], scientific: 'Centropristis striata', category: 'reef',
    keyIds: ['Stocky black to dusky-blue body with pale spots arranged in rows', 'Large mouth, broad dorsal fin with elongated trailing rays', 'Rounded tail; top ray often extended in mature males', 'Mature males develop a fleshy nuchal hump behind the head'],
    lookalikes: [],
    habitat: 'Reefs, wrecks, and hard bottom from 10–400 ft. Primarily an Atlantic species (Cape Cod to Florida); rare in the Gulf.', typicalSize: '10–18 in', reefFish: true },
  { id: 'blacknose_shark', commonName: 'Blacknose Shark', altNames: [], scientific: 'Carcharhinus acronotus', category: 'sharks',
    keyIds: ['Distinct dark smudge on the tip of the snout (key feature)', 'Slender body, yellow-brown to gray above with pale belly', 'Second dorsal fin small, well behind anal fin origin', 'Smaller coastal shark — usually under 4 ft'],
    lookalikes: ['atlantic_sharpnose_shark', 'blacktip_shark'],
    habitat: 'Coastal Gulf and South Atlantic waters, 30–200 ft. Common over sandy and shell bottoms.', typicalSize: '36–48 in', hms: true },
  { id: 'bonnethead_shark', commonName: 'Bonnethead Shark', altNames: ['Shovelhead', 'Bonnet Shark'], scientific: 'Sphyrna tiburo', category: 'sharks',
    keyIds: ['Shovel-shaped head (mini hammerhead) — rounded, not wing-like', 'Gray-brown back, pale belly, small dark spots sometimes present', 'Small, slender body — rarely over 4 ft', 'Found in shallow coastal flats, bays, and estuaries'],
    lookalikes: [],
    habitat: 'Shallow bays, flats, and inshore waters, 5–80 ft. Common across the Gulf and southeast Atlantic.', typicalSize: '30–42 in', hms: true },
  { id: 'bluefish', commonName: 'Bluefish', altNames: ['Tailor', 'Snapper Blue'], scientific: 'Pomatomus saltatrix', category: 'reef',
    keyIds: ['Stout body, blue-green back fading to silvery sides', 'Large mouth with prominent, sharp triangular teeth', 'Forked tail; black blotch at base of pectoral fin', 'Aggressive schooling predator — often blitzes bait at the surface'],
    lookalikes: [],
    habitat: 'Coastal Atlantic and northern Gulf, surf zone to offshore. Primarily Atlantic — occasional in Gulf.', typicalSize: '12–24 in' },
  { id: 'butterfish', commonName: 'Butterfish', altNames: ['Dollarfish'], scientific: 'Peprilus triacanthus', category: 'bait',
    keyIds: ['Small, very deep, laterally compressed silver body', 'Forked tail; no pelvic fins', 'Single long dorsal fin; row of pores below dorsal', 'Bluish back fading to silver — looks like a coin'],
    lookalikes: [],
    habitat: 'Atlantic continental shelf, surface to 600 ft. Schools over sandy bottoms.', typicalSize: '6–9 in' },
  { id: 'warsaw_grouper', commonName: 'Warsaw Grouper', altNames: ['Warsaw', 'Black Jewfish'], scientific: 'Hyporthodus nigritus', category: 'grouper',
    keyIds: ['Massive deep-water grouper — can exceed 400 lb', 'Dark reddish-brown to nearly black body', 'Second dorsal spine very long and stout (key feature)', 'Square tail; juveniles show yellow blotches that fade with age', 'Found very deep — 300–1,700 ft'],
    lookalikes: ['snowy_grouper', 'black_grouper'],
    habitat: 'Deep rocky bottoms, ledges, drop-offs, 300–1,700 ft.', typicalSize: '40–80 in', reefFish: true },
  { id: 'blackfin_snapper', commonName: 'Blackfin Snapper', altNames: ['Hambone'], scientific: 'Lutjanus buccanella', category: 'snapper',
    keyIds: ['Distinct black blotch at the base of the pectoral fin (key feature)', 'Reddish body with yellow-tinged tail and fins', 'Anal fin rounded, similar to vermilion', 'Deep-water snapper, 200–700 ft'],
    lookalikes: ['red_snapper', 'vermilion_snapper', 'queen_snapper'],
    habitat: 'Deep reefs and rocky ledges, 200–700 ft.', typicalSize: '12–20 in', reefFish: true },
  { id: 'queen_snapper', commonName: 'Queen Snapper', altNames: ['Brim', 'Carde'], scientific: 'Etelis oculatus', category: 'snapper',
    keyIds: ['Brilliant rose-red body with silvery sheen', 'Very large eye (deep-water adaptation)', 'Deeply forked tail with elongated, trailing tips', 'Slender body — more elongate than red snapper', 'Deep-water snapper, 400–1,500 ft'],
    lookalikes: ['red_snapper'],
    habitat: 'Deep rocky bottoms and steep drop-offs, 400–1,500 ft.', typicalSize: '20–36 in', reefFish: true },
  { id: 'yellowmouth_grouper', commonName: 'Yellowmouth Grouper', altNames: ['Yellowmouth'], scientific: 'Mycteroperca interstitialis', category: 'grouper',
    keyIds: ['Bright yellow corners and lining of the mouth (key feature)', 'Body tan to brown with small dark spots and pale blotches', 'Caudal rays extended slightly ("broomtail"-like, less than scamp)', 'Yellow margin on pectoral and caudal fins'],
    lookalikes: ['scamp', 'gag_grouper'],
    habitat: 'Reefs, ledges, and hard bottom, 80–500 ft.', typicalSize: '15–24 in', reefFish: true },
  { id: 'snowy_grouper', commonName: 'Snowy Grouper', altNames: ['Snowy'], scientific: 'Hyporthodus niveatus', category: 'grouper',
    keyIds: ['Dark chocolate-brown body covered in scattered white spots (juveniles especially)', 'White spots fade with age — large adults often nearly uniform dark', 'Square or slightly concave tail with pale margin', 'Black saddle blotch on caudal peduncle', 'Deep-water grouper — typically 300–1,500 ft'],
    lookalikes: ['gag_grouper', 'red_grouper'],
    habitat: 'Deep rocky bottoms and ledges, 300–1,500 ft. Gulf and South Atlantic deep-water grouper complex.', typicalSize: '24–40 in', reefFish: true },
  { id: 'hogfish', commonName: 'Hogfish', altNames: ['Hog Snapper'], scientific: 'Lachnolaimus maximus', category: 'reef',
    keyIds: ['Long pig-like snout (key feature)', 'First three dorsal spines very long and trailing', 'Pinkish to reddish body; large males show a dark blotch behind pectoral fin', 'Sharp protruding canine teeth at the front of the mouth', 'A wrasse — not a snapper despite the "hog snapper" name'],
    lookalikes: [],
    habitat: 'Reefs and hard bottom, 10–200 ft. Common around Florida and the eastern Gulf.', typicalSize: '14–24 in', reefFish: true },
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
    bigeye_tuna: R({
      default: { open: 'Check current season', minSize: null, bagLimit: null, notes: 'Federally managed HMS — HMS Angling or Charter/Headboat permit required. No fixed rec size limit on file; verify current rules with NOAA.' },
      source: 'fisheries.noaa.gov',
    }),
    atlantic_cod: R({
      default: { open: 'Not a Gulf of America species', minSize: null, bagLimit: null, notes: 'Atlantic Cod is managed by NOAA in the Northeast region (Gulf of Maine / Georges Bank). Outside the Gulf of America scope of this app — rules differ by region. Verify with the appropriate agency.' },
      source: 'fisheries.noaa.gov',
    }),
    goliath_grouper: R({
      default: { open: 'Closed — catch-and-release only', minSize: null, bagLimit: 0, notes: 'Goliath Grouper has been protected in federal Gulf waters since 1990 (state rules vary). Catch-and-release only with limited exceptions — Florida runs a small permitted state-water harvest. Verify before keeping; default to release.', gear: reefGear },
      source: 'fisheries.noaa.gov',
    }),
    atlantic_mackerel: R({
      default: { open: 'Not a Gulf of America species', minSize: null, bagLimit: null, notes: 'Atlantic Mackerel is managed by the New England Fishery Management Council. Outside the Gulf of America scope of this app — rules differ by region. Verify with the appropriate agency.' },
      source: 'fisheries.noaa.gov',
    }),
    atlantic_menhaden: R({
      default: { open: 'Bait species — no recreational size/bag', minSize: null, bagLimit: null, notes: 'Atlantic Menhaden is managed by ASMFC under an interstate plan. Common as bait; commercial reduction fishery rules apply where relevant. Verify any state-specific bait-fish rules.' },
      source: 'asmfc.org',
    }),
    atlantic_sharpnose_shark: R({
      default: { open: 'Check current season', minSize: null, bagLimit: 1, gear: ['Non-offset non-stainless circle hooks (sharks)'], notes: 'HMS Angling or Charter/Headboat permit + shark endorsement required. Counted within the 1 additional Atlantic sharpnose per angler federal allowance. Verify with NOAA HMS.' },
      source: 'fisheries.noaa.gov',
    }),
    shortfin_mako_shark: R({
      default: { open: 'Retention prohibited (Atlantic)', minSize: null, bagLimit: 0, gear: ['Non-offset non-stainless circle hooks (sharks)'], notes: 'Atlantic shortfin mako is overfished. NOAA prohibits retention of shortfin mako in Atlantic HMS recreational and commercial fisheries — release alive. HMS permit + shark endorsement required if targeting sharks. Verify with NOAA HMS.' },
      source: 'fisheries.noaa.gov',
    }),
    atlantic_sturgeon: R({
      default: { open: 'Closed — federally endangered, no take', minSize: null, bagLimit: 0, notes: 'Atlantic Sturgeon is listed under the Endangered Species Act (most U.S. DPSs endangered, Gulf of Maine DPS threatened). Take is prohibited. If hooked incidentally, release immediately without removing from water when possible. Not a Gulf of America species.' },
      source: 'fisheries.noaa.gov',
    }),
    black_sea_bass: R({
      default: { open: 'Check current season', minSize: null, bagLimit: null, gear: reefGear, notes: 'Black Sea Bass is primarily an Atlantic species (Cape Cod to Florida) and is managed by the Mid-Atlantic and South Atlantic councils with seasonal closures and possession limits. Not a Gulf of America management species — verify with the appropriate region before keeping.' },
      source: 'fisheries.noaa.gov',
    }),
    blacknose_shark: R({
      default: { open: 'Check current season', minSize: null, bagLimit: 1, gear: ['Non-offset non-stainless circle hooks (sharks)'], notes: 'HMS Angling or Charter/Headboat permit + shark endorsement required. Atlantic blacknose is part of the small coastal shark complex with restricted harvest; verify regional retention rules with NOAA HMS.' },
      source: 'fisheries.noaa.gov',
    }),
    bonnethead_shark: R({
      default: { open: 'Check current season', minSize: null, bagLimit: 1, gear: ['Non-offset non-stainless circle hooks (sharks)'], notes: 'HMS Angling or Charter/Headboat permit + shark endorsement required. Bonnethead is a small coastal shark in the SCS complex — counted in the 1 additional shark (sharpnose/bonnethead) federal allowance. Verify with NOAA HMS.' },
      source: 'fisheries.noaa.gov',
    }),
    bluefish: R({
      default: { open: 'Check current season', minSize: null, bagLimit: null, notes: 'Bluefish is primarily an Atlantic species, jointly managed by ASMFC and the Mid-Atlantic Council with regional bag limits (typically 3 fish private rec, 5 for-hire). Not a Gulf of America management species — verify with the appropriate region.' },
      source: 'asmfc.org',
    }),
    butterfish: R({
      default: { open: 'Bait/forage species — no recreational size/bag', minSize: null, bagLimit: null, notes: 'Butterfish is managed by the Mid-Atlantic Council, primarily as a commercial small-mesh fishery. Common as cut bait and forage for predators. No recreational size/bag on file — verify any state-specific bait-fish rules.' },
      source: 'fisheries.noaa.gov',
    }),
    warsaw_grouper: R({
      default: { open: 'Check current season', minSize: null, bagLimit: 1, gear: reefGear, notes: 'Gulf deep-water grouper aggregate. Federal limit typically 1 fish/vessel/day for Warsaw (separate from the aggregate count). Slow growth, late maturity — handle carefully. South Atlantic has additional restrictions (often catch-and-release). Verify with the agency.' },
      source: 'fisheries.noaa.gov',
    }),
    blackfin_snapper: R({
      default: { open: 'Year-round (verify)', minSize: 12, bagLimit: 10, gear: reefGear, notes: 'Gulf deep-water snapper. Part of the snapper aggregate (10/person/day federal Gulf, minus the 2 red snapper and 10 vermilion). Verify before keeping.' },
      source: 'fisheries.noaa.gov',
    }),
    queen_snapper: R({
      default: { open: 'Year-round (verify)', minSize: null, bagLimit: 10, gear: reefGear, notes: 'Gulf deep-water snapper. Part of the snapper aggregate (10/person/day federal Gulf, minus the 2 red snapper and 10 vermilion). No species-specific size limit on file. Verify before keeping.' },
      source: 'fisheries.noaa.gov',
    }),
    yellowmouth_grouper: R({
      default: { open: 'Year-round (verify)', minSize: 20, bagLimit: 2, gear: reefGear, notes: 'Gulf shallow-water grouper aggregate (with gag, red, black, scamp, yellowfin). Aggregate bag and seasonal closures apply. Verify before keeping.' },
      tx_state: { minSize: 18, bagLimit: 4 },
      source: 'fisheries.noaa.gov',
    }),
    snowy_grouper: R({
      default: { open: 'Check current season', minSize: null, bagLimit: null, gear: reefGear, notes: 'Gulf deep-water grouper aggregate. Federal Gulf deep-water grouper aggregate limit applies (typically 4 fish, with snowy/yellowedge/warsaw/speckled hind combined). South Atlantic management is stricter with seasonal closures. Verify with the agency.' },
      source: 'fisheries.noaa.gov',
    }),
    hogfish: R({
      default: { open: 'Check current season', minSize: 14, bagLimit: 1, gear: reefGear, notes: 'Gulf reef fish. Federal Gulf recreational rules: 14 in fork length, 1 fish/person/day. Florida Gulf state waters have additional seasonal closures (closed Nov 1 – Mar 31 typical). Verify before keeping.' },
      fl_state: { open: 'Apr 1 – Oct 31 (verify)', minSize: 14, bagLimit: 1, notes: 'Florida Gulf: 14 in fork length, 1/person/day, season Apr 1 – Oct 31.' },
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
