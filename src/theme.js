/* Theme — premium offshore marine, dark navy + cyan accent.
   Tuned to the ReelIntel home-screen mockup. */

/* Layout breakpoints. Phone-first: the outer container is 440px wide
   by default (fits the iPhone Pro-Max width). On iPad we widen to
   720px portrait / 900px landscape so the app doesn't render as a
   thin column marooned in the middle of the screen. */
export const BREAKPOINT = {
  tablet: 768,          // iPad portrait floor
  tabletLandscape: 1024,
};
export const WIDTH = {
  phone: 440,
  tabletPortrait: 720,
  tabletLandscape: 900,
};

/* Read the current window width once at first call; the App.jsx hook
   wraps this in a resize listener so the UI reflows on rotation. */
export function screenSize(width = typeof window !== 'undefined' ? window.innerWidth : 0) {
  if (width >= BREAKPOINT.tabletLandscape) return 'tablet-landscape';
  if (width >= BREAKPOINT.tablet)          return 'tablet';
  return 'phone';
}
/* Container max-width policy: on phone we clamp to 440 so the shell
   never gets stretched by a landscape rotation; on tablet we let the
   viewport drive width (no cap) so the app fills the iPad. Prose
   blocks inside cards apply their own reading-max-width so long
   paragraphs don't lose scannability at wide widths. */
export function containerMaxWidth(size = screenSize()) {
  if (size === 'tablet-landscape') return 'none';
  if (size === 'tablet')           return 'none';
  return WIDTH.phone;
}
export const isTabletSize = (size = screenSize()) => size !== 'phone';
export const isPhoneSize  = (size = screenSize()) => size === 'phone';

/* Type scale — bumps on tablet so the app feels iPad-native, not a
   scaled-up phone screen. Grouped by size tier so screens can either
   read the whole object or a single key. Sizes are in px. */
export const TYPE = {
  phone: {
    h1: 24, h2: 20, h3: 17,
    body: 14, bodyStrong: 15,
    small: 12, tiny: 11,
    sectionLabel: 11,
  },
  tablet: {
    h1: 32, h2: 26, h3: 20,
    body: 17, bodyStrong: 18,
    small: 14, tiny: 12,
    sectionLabel: 12,
  },
  'tablet-landscape': {
    h1: 36, h2: 28, h3: 22,
    body: 18, bodyStrong: 19,
    small: 15, tiny: 13,
    sectionLabel: 13,
  },
};
export function typeScale(size = screenSize()) {
  return TYPE[size] || TYPE.phone;
}

/* Column counts per section per size. Screens read these instead of
   hand-rolling media queries so column policy stays consistent. */
export const COLS = {
  phone:              { home: 1, categories: 3, browse: 3, regsList: 1, logList: 1, pbsList: 1 },
  tablet:             { home: 3, categories: 4, browse: 4, regsList: 1, logList: 1, pbsList: 2 },
  'tablet-landscape': { home: 4, categories: 5, browse: 5, regsList: 2, logList: 2, pbsList: 2 },
};
export function cols(size = screenSize()) {
  return COLS[size] || COLS.phone;
}

/* Header + footer heights — larger on tablet so tap targets scale
   with the device. Wired via CSS custom properties from App.jsx. */
export function chromeHeights(size = screenSize()) {
  if (size === 'tablet-landscape') return { header: 84, footer: 88 };
  if (size === 'tablet')           return { header: 76, footer: 80 };
  return                                  { header: 72, footer: 64 };
}

/* Reading-max-width for prose text. Applied inline on species detail
   paragraphs, notes bodies, regulation notes — long text lines stop
   at ~72ch so they stay comfortable to scan. */
export const READING_MAX = '72ch';

export const T = {
  /* page + surfaces — deep navy gradient floor */
  bg: '#031B33',
  bgDeep: '#06111F',
  bgGradient: 'linear-gradient(180deg, #031B33 0%, #06111F 100%)',

  /* light foreground (text on dark surfaces) */
  parchment: '#FFFFFF',
  parchmentDeep: '#0B2740',  // recessed surface (inputs, empty states)

  /* cards + borders */
  card: '#0B2740',
  cardEdge: 'rgba(15, 94, 133, 0.35)', // subtle cyan glow border
  cardEdgeStrong: '#19D4F2',           // active / hero outline

  /* text */
  ink: '#FFFFFF',
  inkSoft: '#CBD5E1',
  inkMute: '#94A3B8',

  /* brand accent (bright cyan/teal) */
  brass: '#19D4F2',
  brassDeep: '#13B4D0',

  /* hero / deep-blue surfaces */
  ocean: '#0E3454',
  oceanDeep: '#031B33',

  /* status — colorblind-safe pairs, tuned for dark */
  open: '#32D17B',
  openBg: 'rgba(50, 209, 123, 0.12)',
  closed: '#FF4D4D',
  closedBg: 'rgba(255, 77, 77, 0.10)',
  warn: '#FFC857',
  warnBg: 'rgba(255, 200, 87, 0.10)',
};
