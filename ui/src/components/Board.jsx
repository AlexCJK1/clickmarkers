// The board: every ticket by where it stands. An empty column folds to a narrow rail that says so, and
// the space goes to the columns with work in them (done most of all).
import React, { useState } from 'react';
import { useActions, useIsPhone, useTickets } from '../lib/hooks.js';
import { Sheet } from './Sheet.jsx';
import Ticket from './Ticket.jsx';
import { Icon, Seg } from './ui.jsx';

const COLS = [['next', 'Next', ['scheduled', 'next', 'inbox', 'blocked'], 'Nothing queued or booked'], ['doing', 'Doing', ['doing'], 'Nothing doing'], ['waiting', 'Waiting for you', ['waiting'], 'Nothing waiting'], ['done', 'Done', ['done', 'failed', 'cancelled'], 'Nothing finished yet']];

export default function Board() {
  const a = useActions(); const tickets = useTickets(); const phone = useIsPhone(); const [open, setOpen] = useState(null); const [col, setCol] = useState('done');
  const by = Object.fromEntries(COLS.map(([k, , states]) => [k, tickets.filter(t => states.includes(t.state)).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))]));
  const failed = by.done.filter(t => t.state === 'failed').length;
  const list = (k, wide) => <div className={`board-list ${wide ? 'wide' : ''}`}>{by[k].slice(0, 60).map(t => <Ticket key={t.id} t={t} showDesk open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />)}{by[k].length > 60 && <p className="meta t3">And {by[k].length - 60} more.</p>}</div>;
  return (
    <Sheet title="Board" size="xl" onClose={() => a.drawer(null)} sub={`${tickets.length} tickets, newest first in each column${failed ? `, ${failed} failed` : ''}`} bodyClass="fill">
      {phone ? (
        <>
          <Seg label="Column" value={col} onChange={setCol} options={COLS.map(([k, l]) => [k, `${l === 'Waiting for you' ? 'Waiting' : l} ${by[k].length}`])} className="seg-full" />
          {by[col].length ? list(col, false) : <p className="meta t3" style={{ padding: 16 }}>{COLS.find(c => c[0] === col)[3]}.</p>}
        </>
      ) : (
        <div className="board">
          {COLS.map(([k, label, , none]) => {
            const n = by[k].length;
            if (!n) return <section key={k} className="board-col rail" aria-label={`${label}, empty`}><h3 className="board-h"><span>{label}</span><span className="count">0</span></h3><p className="meta t3"><Icon name="info" size={14} />{none}</p></section>;
            return <section key={k} className={`board-col ${k === 'done' ? 'grow' : ''}`} aria-label={label}><h3 className="board-h"><span>{label}</span><span className={`count ${k === 'waiting' ? 'count-warn' : ''}`}>{n}</span></h3>{list(k, k === 'done')}</section>;
          })}
        </div>
      )}
    </Sheet>
  );
}
