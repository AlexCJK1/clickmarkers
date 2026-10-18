// The connector status bar under the war room: every outside tool a desk uses, with its health from the
// last check. The healthy ones are a quiet list; one that failed, needs a sign-in or lacks a key is a tag
// with the reason. "Check now" probes them all (K): one tiny session each, a minute or two in all.
// The hover tips are a shortcut for the mouse; the same facts, as text, are in the Details sheet (the
// whole row on the phone), so nothing here is a focus stop that only shows a tip.
import React, { useMemo, useState } from 'react';
import { useActions, useConnectors, useDesks } from '../lib/hooks.js';
import { useOffice } from '../lib/store.js';
import { ago, plain } from '../lib/format.js';
import { Icon, Tag, Tip } from './ui.jsx';
import { Modal } from './Sheet.jsx';

const WORD = { connected: 'connected', 'needs-auth': 'needs a sign-in', failed: 'failed its check', absent: 'not found', missing: 'is missing a key', off: 'off' };
const short = l => String(l || '').replace(/\s*\((direct|Playwright|IMAP)\)/, '').replace(/^Google /, '').replace(/ for Business$/, '');

export function useConnectorHealth() {
  const registry = useConnectors(); const desks = useDesks();
  return useMemo(() => {
    const by = {}; for (const d of desks) for (const k of d.tools || []) (by[k] ||= []).push(d.name);
    const used = registry.filter(c => by[c.key] && !c.disabled).map(c => ({ ...c, desks: by[c.key], status: c.health?.status || 'unchecked' }));
    return { used, ok: used.filter(c => c.status === 'connected'), bad: used.filter(c => !['connected', 'off', 'unchecked'].includes(c.status)), unchecked: used.filter(c => c.status === 'unchecked') };
  }, [registry, desks]);
}
const tipOf = c => `${c.label}\n${c.status === 'unchecked' ? 'Not checked yet' : `${c.status.charAt(0).toUpperCase()}${(WORD[c.status] || c.status).slice(1)}`}${c.health?.tools ? ` · ${c.health.tools} tools` : ''}${c.health?.ms ? ` · started in ${(c.health.ms / 1000).toFixed(1)} s` : ''}${c.health?.note ? `\n${c.health.note}` : ''}\nChecked ${ago(c.health?.at)}\nUsed by ${c.desks.join(', ')}`;

const level = c => (c.status === 'connected' ? 'good' : c.status === 'needs-auth' ? 'warn' : c.status === 'unchecked' || c.status === 'off' ? 'neutral' : 'serious');
const word = c => (c.status === 'unchecked' ? 'not checked yet' : WORD[c.status] || c.status);

function Details({ used, check, onClose }) {
  const order = { failed: 0, absent: 0, missing: 1, 'needs-auth': 1, unchecked: 2, off: 3, connected: 4 };
  const rows = [...used].sort((x, y) => (order[x.status] ?? 2) - (order[y.status] ?? 2) || x.label.localeCompare(y.label));
  return (
    <Modal title="Connectors" sub="Every outside tool a desk uses, from the last check." onClose={onClose} width={720} footer={check}>
      <ul className="conn-sheet">
        {rows.map(c => (
          <li key={c.key}>
            <div className="conn-sheet-top"><b>{c.label}</b><Tag level={level(c)}>{word(c)}</Tag></div>
            <div className="meta t2">{[c.health?.tools && `${c.health.tools} tools`, c.health?.ms && `started in ${(c.health.ms / 1000).toFixed(1)} s`, c.health?.at && `checked ${ago(c.health.at)}`].filter(Boolean).join(' · ') || 'No check on record'}</div>
            {c.health?.note && <div className="meta t2">{c.health.note}</div>}
            <div className="meta t3">Used by {c.desks.join(', ')}</div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export default function ConnectorStrip({ phone = false }) {
  const { used, ok, bad, unchecked } = useConnectorHealth(); const a = useActions(); const probing = useOffice(s => s.probing);
  const [open, setOpen] = useState(false); const [err, setErr] = useState('');
  if (!used.length) return null;
  const run = async () => { setErr(''); const r = await a.checkConnectors(); if (r?.error) setErr(`Not checked. ${plain(r.error)}`); };
  const check = <Tip text="Check every connector in use, a minute or two (K)"><button type="button" className="btn btn-secondary btn-sm" disabled={probing} onClick={run}><Icon name="refresh" size={14} />{probing ? 'Checking…' : 'Check now'}</button></Tip>;
  const errLine = err && <div className="err-line" role="alert"><Icon name="critical" size={14} sw={2} /><span>{err}</span></div>;
  const sheet = open && <Details used={used} check={<>{errLine}{check}</>} onClose={() => setOpen(false)} />;
  if (phone) {
    return (
      <>
        <button type="button" className="ph-conn" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Icon name="plug" size={15} /><span>{ok.length} of {used.length} connectors fine</span>
          {bad[0] && <span className="conn-tag"><Tag level={level(bad[0])}>{short(bad[0].label)}{bad.length > 1 ? ` and ${bad.length - 1} more` : ''}</Tag></span>}
          <Icon name="chevron" size={16} className="t3 ph-conn-go" />
        </button>
        {sheet}
      </>
    );
  }
  return (
    <>
    <div className="statusbar" role="region" aria-label="Connectors">
      <span className="sb-lbl"><Icon name="plug" size={15} /><span className="sb-word">Connectors</span></span>
      <div className="conn-list">
        <span className="conn-ok"><Icon name="check" size={14} sw={2.2} />{ok.length} connected:</span>
        <span className="conn-names">{ok.map((c, i) => <Tip key={c.key} text={tipOf(c)}><span className="conn-name">{short(c.label)}{i < ok.length - 1 ? ', ' : ''}</span></Tip>)}</span>
        {unchecked.length > 0 && <span className="t3">· {unchecked.length} not checked yet</span>}
      </div>
      {/* one or two problems are named; more (a new install with tools not set up yet) become one tag, listed in Details */}
      {bad.length <= 2 ? bad.map(c => <Tip key={c.key} text={tipOf(c)}><span className="conn-tag"><Tag level={level(c)}>{short(c.label)} {word(c)}</Tag></span></Tip>)
        : <Tip text={bad.map(c => `${short(c.label)}: ${word(c)}`).join('\n')}><span className="conn-tag"><Tag level={bad.some(c => level(c) === 'serious') ? 'serious' : 'warn'}>{bad.length} need setting up or checking</Tag></span></Tip>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">Details</button>
      {check}
      {sheet}
    </div>
    {!open && err && <div className="sb-err">{errLine}</div>}
    </>
  );
}
