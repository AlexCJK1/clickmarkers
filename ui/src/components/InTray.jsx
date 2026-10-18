// The in-tray: drafts waiting for the owner's OK, newest first. Each shows who wrote it, the evaluations
// desk's verdict and any note it left, and the draft itself, with Approve and Reject.
import React, { useState } from 'react';
import { useActions, useInTray } from '../lib/hooks.js';
import { useOffice, deskName } from '../lib/store.js';
import { when } from '../lib/format.js';
import { Sheet } from './Sheet.jsx';
import Ticket, { Verdict } from './Ticket.jsx';
import { Empty, Icon } from './ui.jsx';

export function TrayList() {
  const items = useInTray();
  const names = useOffice(s => x => deskName(s, x));
  const sorted = [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const [open, setOpen] = useState(() => sorted[0]?.id || null);
  if (!sorted.length)
    return (
      <Empty icon="inbox" title="Nothing is waiting">
        Drafts that need your OK land here and on the phone. A desk never sends, posts or spends without it.
      </Empty>
    );
  return (
    <ul className="tray">
      {sorted.map(t => (
        <li key={t.id} className="tray-item">
          <div className="tray-h">
            <Icon name="warn" size={14} sw={2} className="warn-ic" />
            <b>{names(t.agent)}</b>
            <span className="t3">
              {when(t.updatedAt)}
              {t.routine ? ' · from a routine' : ''}
            </span>
          </div>
          <Verdict t={t} />
          <Ticket t={t} tray open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
        </li>
      ))}
    </ul>
  );
}

export default function InTray() {
  const a = useActions();
  const n = useInTray().length;
  return (
    <Sheet
      title="In-tray"
      size="md"
      onClose={() => a.drawer(null)}
      sub={
        n
          ? `${n} draft${n === 1 ? '' : 's'} waiting for your OK. Approve carries out the steps you read, with only the tools they name; Reject sends it back with your note.`
          : 'Drafts waiting for your OK'
      }
    >
      <TrayList />
    </Sheet>
  );
}
