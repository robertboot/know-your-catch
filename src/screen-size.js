/* Screen-size context — the current viewport tier ('phone' |
   'tablet' | 'tablet-landscape'), plus the derived typeScale, cols,
   and chromeHeights snapshots at that tier.

   App.jsx wraps the tree in <ScreenSizeContext.Provider>. Any screen
   or component calls useScreenSize() to read it. Avoids threading
   the size prop through every screen for iPad layout adaptations.
*/
import { createContext, useContext } from 'react';
import { screenSize, typeScale, cols, chromeHeights } from './theme.js';

const initial = () => {
  const s = screenSize();
  return { size: s, type: typeScale(s), cols: cols(s), chrome: chromeHeights(s) };
};

export const ScreenSizeContext = createContext(initial());
export function useScreenSize() { return useContext(ScreenSizeContext); }
