// The power-on: the mark and the name while the office answers, gone as soon as it does (under a second
// once the data is in). Any key or click skips it; with reduced motion it simply disappears. Once per
// browser session.
import React, { useEffect, useState } from 'react';
import { useReady, useReducedMotion } from '../lib/hooks.js';
import { Mark } from './Header.jsx';

export default function PowerOn({ onDone }) {
  const ready = useReady(); const reduced = useReducedMotion(); const [out, setOut] = useState(false); const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 2500); return () => clearTimeout(t); }, []);
  useEffect(() => { if (!ready) return undefined; if (reduced) { onDone(); return undefined; } const t = setTimeout(() => setOut(true), 500); const u = setTimeout(onDone, 850); return () => { clearTimeout(t); clearTimeout(u); }; }, [ready, reduced, onDone]);
  useEffect(() => { const k = () => onDone(); window.addEventListener('keydown', k, { once: true }); return () => window.removeEventListener('keydown', k); }, [onDone]);
  return (
    <div className={`intro ${out ? 'out' : ''}`} onClick={onDone} role="status" aria-live="polite">
      <Mark size={56} />
      <div className="brand-name intro-name">Nightdesk</div>
      <div className="meta t3">{ready ? 'Opening the office' : slow ? 'Waiting for the office on this port' : 'Connecting to the office'}</div>
      <button type="button" className="btn btn-ghost btn-sm intro-skip" onClick={onDone}>Skip</button>
    </div>
  );
}
