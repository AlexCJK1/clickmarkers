// The sheets that open over the page (they were drawers once; the store still calls the open one
// `drawer`): in-tray, board, ledger, routines, numbers, calendar, brain and help.
import React from 'react';
import { useDrawer } from '../lib/hooks.js';
import InTray from './InTray.jsx';
import Board from './Board.jsx';
import Ledger from './Ledger.jsx';
import Routines from './Routines.jsx';
import Numbers from './Numbers.jsx';
import Calendar from './Calendar.jsx';
import BrainGraph from './BrainGraph.jsx';
import Help from './Help.jsx';
export { SHORTCUTS } from './Help.jsx';

const SHEETS = { intray: InTray, board: Board, ledger: Ledger, routines: Routines, numbers: Numbers, calendar: Calendar, brain: BrainGraph, help: Help };

export default function Drawers() {
  const drawer = useDrawer(); const S = SHEETS[drawer];
  return S ? <S key={drawer} /> : null;
}
