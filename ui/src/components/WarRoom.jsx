// The war room panel: the 3D table, a one-line summary of what the office is doing, the legend for the
// pods' states, and the connector bar underneath.
import React from 'react';
import Floor from '../floor/Floor.jsx';
import ConnectorStrip from './ConnectorStrip.jsx';
import { useOffice } from '../lib/store.js';
import { Icon } from './ui.jsx';

export function useRoomSummary() {
  const working = useOffice(s => Object.keys(s.running).length); const waiting = useOffice(s => Object.values(s.waiting).reduce((a, b) => a + b, 0)); const failed = useOffice(s => Object.keys(s.failed || {}).length);
  const quiet = !working && !waiting;
  return { working, waiting, failed, text: `${quiet ? 'All quiet: ' : ''}${working} working, ${waiting} waiting for you${failed ? `, ${failed} failed` : ''}` };
}

export function Legend({ className = '' }) {
  return (
    <div className={`room-legend ${className}`} aria-label="What the pods show">
      <span><Icon name="ring" size={13} sw={2} className="lg-idle" />Idle</span>
      <span><Icon name="working" size={13} sw={2} className="lg-working" />Working</span>
      <span><Icon name="warn" size={13} sw={2} className="lg-waiting" />Waiting for you</span>
      <span><Icon name="critical" size={13} sw={2} className="lg-failed" />Failed</span>
      <span><Icon name="pause" size={13} sw={2} className="lg-paused" />Paused</span>
    </div>
  );
}

export default function WarRoom({ phone = false }) {
  const sum = useRoomSummary();
  return (
    <section className={`panel room ${phone ? 'ph-room' : ''}`} aria-labelledby="room-t">
      <div className="panel-h room-h">
        <div className="room-title">
          <h2 id="room-t" className={phone ? 'title-s' : 'title-l'}>War room</h2>
          <span className="stat room-sum">{sum.working ? <i className="live-dot sm" /> : <i className="idle-dot sm" />}{phone ? `${sum.working} working · ${sum.waiting} waiting` : sum.text}</span>
        </div>
        {!phone && <Legend className="legend-hdr" />}
      </div>
      <div className="room-stage"><Floor />{!phone && <Legend className="legend-stage" />}</div>
      <ConnectorStrip phone={phone} />
    </section>
  );
}
