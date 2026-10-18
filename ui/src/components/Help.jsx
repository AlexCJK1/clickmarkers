// Help: the keys, how to move round the war room, what the pods' states mean, and the About line. The
// attribution in About is an additional term of the licence (NOTICE, AGPL section 7(b)): keep it in any copy.
import React from 'react';
import { useActions } from '../lib/hooks.js';
import { Sheet } from './Sheet.jsx';
import { Legend } from './WarRoom.jsx';

export const SHORTCUTS = [['1 to 6', 'Open a department lead (Marketing, Leads, Inbox, Operations, Finance, Delivery)'], ['0 or Esc', 'Back to the whole office'], ['/', 'Type a job'], ['M', 'Speak a job (the mic)'], ['Ctrl+Shift+E', 'The big editor'], ['I', 'In-tray'], ['B', 'Board'], ['L', 'Ledger'], ['R', 'Routines'], ['N', 'Numbers'], ['C', 'Calendar'], ['G', 'Brain'], ['K', 'Check the connectors'], ['?', 'This list']];
export const SOURCE = 'https://github.com/AlexCJK1/nightdesk';
const ROOM = [['Drag a pod', 'Move it; the layout is remembered in this browser'], ['Drag the table', 'Orbit round the hub'], ['Right-drag', 'Slide the view'], ['Scroll', 'Zoom, within limits'], ['Click a pod or its label', 'Open the desk'], ['Reset layout', 'Put every pod back where the office places it']];

export default function Help() {
  const a = useActions();
  return (
    <Sheet title="Keys and help" size="md" onClose={() => a.drawer(null)} sub="Keys work when you are not typing in a box.">
      <section><h3 className="title-s">Keys</h3>
        <table className="tbl keys"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><span className="kbd">{k}</span></td><td className="strong">{v}</td></tr>)}</tbody></table>
      </section>
      <section><h3 className="title-s">The war room</h3>
        <table className="tbl keys"><tbody>{ROOM.map(([k, v]) => <tr key={k}><td className="strong">{k}</td><td>{v}</td></tr>)}</tbody></table>
      </section>
      <section><h3 className="title-s">What the pods show</h3><p className="meta">A pod is neutral while its desk is idle. Its ring turns teal while the desk works or is in your hand, yellow when a draft waits for you, red when its last job failed, and dark when the desk is paused. The label under it says the same in words.</p><Legend /></section>
      <section aria-label="About"><h3 className="title-s">About</h3><p className="meta"><b>Nightdesk</b> by Alex Cojoaca. Free software under the GNU AGPL 3.0: you may use, study, change and share it. <a className="link" href={SOURCE} target="_blank" rel="noreferrer">Source code</a>.</p></section>
    </Sheet>
  );
}
