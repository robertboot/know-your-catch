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
export function containerMaxWidth(size = screenSize()) {
  if (size === 'tablet-landscape') return WIDTH.tabletLandscape;
  if (size === 'tablet')           return WIDTH.tabletPortrait;
  return WIDTH.phone;
}
export const isTabletSize = (size = screenSize()) => size !== 'phone';

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
