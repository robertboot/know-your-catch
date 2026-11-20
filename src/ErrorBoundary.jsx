/* Catches a render throw and shows a recovery screen instead of the
   blank white/dark void two testers reported. React unmounts the whole
   tree on an uncaught render error — without a boundary the user is
   left with nothing to tap and nothing gets logged. */
import React from 'react';
import { T } from './theme.js';
import { reportError } from './error-log.js';

export default class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }

  componentDidCatch(err, info) {
    reportError('react', err, { screen: this.props.screen });
    // Component stack is the most useful part of a React crash and is
    // not on the Error object, so fold it into the stack we send.
    if (info?.componentStack) {
      reportError('react', { message: String(err?.message || err),
                             stack: `${err?.stack || ''}\n--- component stack ---${info.componentStack}` },
                  { screen: this.props.screen });
    }
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', background: T.bgDeep, color: T.ink,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 28, textAlign: 'center',
        fontFamily: '-apple-system, system-ui, sans-serif',
      }}>
        <div style={{ maxWidth: 340 }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>⚓</div>
          <div style={{ fontSize: 21, fontWeight: 800, marginBottom: 10 }}>
            Something broke.
          </div>
          <div style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.6, marginBottom: 22 }}>
            This has been reported automatically — nothing you logged is lost.
            Reopening the app should put you back where you were.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: T.brass, color: T.oceanDeep, border: 'none',
              borderRadius: 12, padding: '15px 26px',
              fontSize: 15, fontWeight: 800, cursor: 'pointer', width: '100%',
            }}
          >Reload ReelIntel</button>
          <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 16, wordBreak: 'break-word' }}>
            {String(this.state.err?.message || this.state.err).slice(0, 160)}
          </div>
        </div>
      </div>
    );
  }
}
