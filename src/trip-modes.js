/* How people fish out here, and which fish each way is aimed at.
 *
 * ONE copy. The admin Trip Planning tab reads it today and the app will
 * read the same list when this reaches the phone — see
 * [[duplicated-knowledge]] for why a second copy of a list like this is a
 * bug waiting its turn.
 *
 * The modes are not a taxonomy, they are a decision: each one consults a
 * different data layer, so picking the mode is what decides whether the
 * answer comes from satellite edges, from structure, or from the bottom
 * contour. Two distinctions matter and both came from Robert:
 *
 *  - Reef fishing wants STRUCTURE, and published artificial reef numbers
 *    are the wrong structure to recommend: everyone has them and they get
 *    hammered. Platforms and pipelines are the layer worth having.
 *
 *  - King and Spanish mackerel are TROLLED but are not pelagic. They
 *    follow bait and nearshore temperature, not the blue-water edge.
 *    Filing them with tuna would send someone forty miles offshore for a
 *    fish that is off the beach.
 */

export const TRIP_MODES = [
  {
    key: 'troll_pelagic',
    label: 'Trolling — pelagic',
    blurb: 'Blue water past the shelf, following the edges.',
    needs: 'Temperature and colour breaks',
    ready: true,
    species: [
      'yellowfin_tuna', 'blackfin_tuna', 'bigeye_tuna', 'bluefin_tuna',
      'mahi', 'wahoo', 'blue_marlin', 'white_marlin', 'sailfish', 'swordfish',
    ],
  },
  {
    key: 'bottom',
    label: 'Reef fishing',
    blurb: 'Snapper and grouper on structure, roughly 100–300 ft.',
    needs: 'Platforms, pipelines and hard bottom',
    ready: false,
    species: [
      'red_snapper', 'vermilion_snapper', 'mangrove_snapper', 'lane_snapper',
      'mutton_snapper', 'gag_grouper', 'red_grouper', 'black_grouper', 'scamp',
      'gray_triggerfish', 'greater_amberjack', 'almaco_jack', 'banded_rudderfish',
    ],
  },
  {
    key: 'deep_drop',
    label: 'Deep drop',
    blurb: '600 ft and down, on the contour and the relief.',
    needs: 'High-resolution bathymetry and bottom relief',
    ready: false,
    species: [
      'swordfish', 'golden_tilefish', 'blueline_tilefish', 'snowy_grouper',
      'yellowedge_grouper', 'warsaw_grouper', 'queen_snapper', 'wreckfish',
      'blackbelly_rosefish',
    ],
  },
  {
    key: 'troll_coastal',
    label: 'Trolling — coastal',
    blurb: 'Trolled, but not offshore fish — these follow the bait.',
    needs: 'Nearshore temperature and bait',
    ready: false,
    species: ['king_mackerel', 'spanish_mackerel', 'cero_mackerel', 'cobia', 'bonito'],
  },
];
