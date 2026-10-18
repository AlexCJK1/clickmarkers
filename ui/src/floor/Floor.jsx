// The React side of the war room: mounts the 3D table once and feeds it from the store directly, outside
// React's render loop. The scene rebuilds only when the company changes; the pods follow running,
// waiting, failed and paused; every new pulse on the wire runs once. Without WebGL the room is a plain
// list of desks with the same states, so nothing is lost.
import React, { useEffect, useRef, useState } from 'react';
import { createFloor } from './graph.js';
import { webglAvailable } from './kit.js';
import { subscribe, getState, actions, deskStatus, useOffice } from '../lib/store.js';
import { useDesks, useIsPhone, reducedMotion } from '../lib/hooks.js';
import { Icon, Tip, DESK_STATE, StateMark } from '../components/ui.jsx';

/** Every desk as a button: the screen reader's way into the room (out of the Tab order, so sighted keyboard
 *  users never land on something they cannot see), and the whole room when there is no WebGL. */
function DeskList({ visible = false }) {
  const desks = useDesks(); const statuses = useOffice(s => s.desks.map(d => deskStatus(s, d.id)).join(','));
  const st = statuses.split(',');
  return (
    <ul className={visible ? 'floor-list' : 'sr-only'} aria-label="Desks on the floor">
      {desks.map((d, i) => <li key={d.id}><button type="button" className="desk-chip" tabIndex={visible ? 0 : -1} onClick={() => actions.select(d.id)}><StateMark status={st[i]} /><span>{d.name}</span>{st[i] !== 'idle' && <span className="t3">{DESK_STATE[st[i]]?.word}</span>}</button></li>)}
    </ul>
  );
}

export default function Floor() {
  const host = useRef(null); const labels = useRef(null); const floorRef = useRef(null); const phone = useIsPhone();
  const [dead, setDead] = useState(() => (webglAvailable() ? '' : 'This browser did not give the page WebGL, so the room is shown as a list.'));
  useEffect(() => {
    if (dead || !host.current) return undefined;
    let floor;
    try { floor = createFloor({ host: host.current, labels: labels.current }, { onSelect: id => actions.select(id), onHover: id => actions.hover(id), onDead: why => setDead(why), reduced: reducedMotion, phone }); }
    catch (e) { console.error('floor', e); setDead(`The 3D room could not start: ${e.message || e}`); return undefined; }
    floorRef.current = floor;
    let dataKey = '', stateKey = '', lastSelected; const seen = new Set();
    const feed = () => {
      const s = getState(); if (!s.ready || !s.company) return;
      const dk = s.desks.map(d => `${d.id}:${d.reportsTo}:${d.dept}:${d.name}`).join(',') + '|' + (s.company.departments || []).map(d => d.id + ':' + d.lead).join(',');
      if (dk !== dataKey) { dataKey = dk; floor.setData({ desks: s.desks, departments: s.company.departments || [] }); stateKey = ''; }
      const paused = {}; for (const d of s.desks) if (d.paused) paused[d.id] = true;
      const sk = JSON.stringify([s.running, s.waiting, s.failed, s.selected, s.hovered, paused]);
      if (sk !== stateKey) { stateKey = sk; floor.setState({ running: s.running, waiting: s.waiting, failed: s.failed || {}, selected: s.selected, hovered: s.hovered, paused }); }
      for (const p of s.pulses) if (!seen.has(p.id)) { seen.add(p.id); if (Date.now() - p.at < 4000) floor.pulse(p); }
      if (seen.size > 4000) { const keep = new Set(s.pulses.map(p => p.id)); seen.clear(); for (const k of keep) seen.add(k); }
      if (s.selected !== lastSelected) { const first = lastSelected === undefined; lastSelected = s.selected; if (!first) floor.focus(s.selected); }
    };
    feed(); const off = subscribe(feed);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)'); const onRm = () => floor.setReduced(mq.matches); mq.addEventListener('change', onRm);
    return () => { off(); mq.removeEventListener('change', onRm); floor.dispose(); floorRef.current = null; };
  }, [dead, phone]);
  if (dead) return <div className="floor-dead"><div className="note" style={{ marginBottom: 12 }}><Icon name="info" size={14} /><span>{dead}</span></div><DeskList visible /></div>;
  return (
    <>
      <div ref={host} className="floor-host" />
      <div ref={labels} className="floor-labels" />
      <DeskList />
      <div className="room-ctl">
        <Tip text="Back to the whole table"><button type="button" className="btn btn-secondary btn-icon btn-sm floor-btn" aria-label="Fit the whole table" onClick={() => { actions.select(null); floorRef.current?.home(); }}><Icon name="fit" size={15} /></button></Tip>
        {!phone && <Tip text="Put every pod back where the office places it"><button type="button" className="btn btn-secondary btn-sm floor-btn" onClick={() => floorRef.current?.resetLayout()}><Icon name="reset" size={14} />Reset layout</button></Tip>}
      </div>
    </>
  );
}
