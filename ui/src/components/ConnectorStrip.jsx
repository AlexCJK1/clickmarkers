// The connector status bar under the war room: every outside tool a desk uses, with its health from the
// last check. Each one is a small glyph with a status dot; one that failed, needs a sign-in or lacks a key
// is also a tag with the reason. "Check now" probes them all (K): one tiny session each, a minute or two in all.
// The hover tips are a shortcut for the mouse; the same facts, as text, are in the Details sheet (the
// whole row on the phone), so nothing here is a focus stop that only shows a tip.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useActions, useConnectors, useDesks } from '../lib/hooks.js';
import { useOffice } from '../lib/store.js';
import { ago, plain } from '../lib/format.js';
import { Icon, Tag, Tip } from './ui.jsx';
import { Modal } from './Sheet.jsx';

const WORD = {
  connected: 'connected',
  'needs-auth': 'needs a sign-in',
  failed: 'failed its check',
  absent: 'not found',
  missing: 'is missing a key',
  off: 'off',
};
const short = l =>
  String(l || '')
    .replace(/\s*\((direct|Playwright|IMAP)\)/, '')
    .replace(/^Google /, '')
    .replace(/ for Business$/, '');

export function useConnectorHealth() {
  const registry = useConnectors();
  const desks = useDesks();
  return useMemo(() => {
    const by = {};
    for (const d of desks) for (const k of d.tools || []) (by[k] ||= []).push(d.name);
    const used = registry
      .filter(c => by[c.key] && !c.disabled)
      .map(c => ({ ...c, desks: by[c.key], status: c.health?.status || 'unchecked' }));
    return {
      used,
      ok: used.filter(c => c.status === 'connected'),
      bad: used.filter(c => !['connected', 'off', 'unchecked'].includes(c.status)),
      unchecked: used.filter(c => c.status === 'unchecked'),
    };
  }, [registry, desks]);
}
const tipOf = c =>
  `${c.label}\n${c.status === 'unchecked' ? 'Not checked yet' : `${c.status.charAt(0).toUpperCase()}${(WORD[c.status] || c.status).slice(1)}`}${c.health?.tools ? ` · ${c.health.tools} tools` : ''}${c.health?.ms ? ` · started in ${(c.health.ms / 1000).toFixed(1)} s` : ''}${c.health?.note ? `\n${c.health.note}` : ''}\nChecked ${ago(c.health?.at)}\nUsed by ${c.desks.join(', ')}`;

const level = c =>
  c.status === 'connected'
    ? 'good'
    : c.status === 'needs-auth'
      ? 'warn'
      : c.status === 'unchecked' || c.status === 'off'
        ? 'neutral'
        : 'serious';
const word = c => (c.status === 'unchecked' ? 'not checked yet' : WORD[c.status] || c.status);

// One quiet line glyph per kind of tool, on the icon set's grid; a tool with no glyph shows its first
// letter. The name and the state are in the tip and in Details, never in the shape alone.
const KIND = {
  parcelcrew: 'package',
  'meta-ads-remote': 'megaphone',
  'tiktok-ads': 'megaphone',
  'google-ads': 'megaphone',
  'x-ads': 'megaphone',
  'snapchat-ads': 'megaphone',
  windsor: 'chart',
  ga4: 'chart',
  posthog: 'pulse',
  'canva-remote': 'palette',
  'figma-remote': 'pen',
  'cloudflare-remote': 'cloud',
  notion: 'book',
  hubspot: 'users',
  buffer: 'send',
  resend: 'send',
  github: 'code',
  stripe: 'card',
  'google-gmail': 'mail',
  mail: 'mail',
  'google-drive': 'folder',
  'google-docs': 'file',
  'google-sheets': 'table',
  'google-calendar': 'calendar',
  browser: 'globe',
  'browser-preview': 'globe',
  'meta-pages': 'image',
  semrush: 'search',
  ahrefs: 'search',
  dataforseo: 'search',
  similarweb: 'search',
};
const GLYPH = {
  package: (
    <>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10.5v3a1 1 0 0 0 1 1h2.5L15 19V5L7.5 9.5H5a1 1 0 0 0-1 1Z" />
      <path d="M18.5 9a4 4 0 0 1 0 6M7.5 14.5 9 20" />
    </>
  ),
  chart: <path d="M4 4v16h16M8 16v-4M12 16V8M16 16v-6" />,
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6H21" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2a1.7 1.7 0 0 1 1.3-2.9H17a4 4 0 0 0 4-4c0-4.5-4-8.2-9-8.2Z" />
      <circle cx="7.5" cy="11.5" r="1" />
      <circle cx="10.5" cy="7.5" r="1" />
      <circle cx="15" cy="8" r="1" />
    </>
  ),
  pen: (
    <>
      <path d="M12 3 6.5 12 12 21l5.5-9L12 3Z" />
      <path d="M12 3v7.5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  cloud: <path d="M7 18.5a4 4 0 0 1-.7-7.95A6 6 0 0 1 17.8 9.6 4.5 4.5 0 0 1 17 18.5H7Z" />,
  book: (
    <>
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5v-14Z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-4" />
    </>
  ),
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  folder: (
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.5h7.4A2.5 2.5 0 0 1 21 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
  ),
  file: (
    <>
      <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  table: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M4 15h16M10 10v10" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.75" />
      <path d="m21 15.5-5-5L6.5 20" />
    </>
  ),
};
function ConnGlyph({ c }) {
  const k = KIND[c.key];
  if (GLYPH[k])
    return (
      <svg
        className="ic"
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {GLYPH[k]}
      </svg>
    );
  if (k) return <Icon name={k} size={18} sw={1.6} />;
  return (
    <span className="conn-mono" aria-hidden="true">
      {short(c.label).charAt(0).toUpperCase()}
    </span>
  );
}
function ConnRow({ c, signIn }) {
  const [say, setSay] = useState('');
  const [busy, setBusy] = useState(false);
  const canSign = c.auth === 'oauth' && c.status === 'needs-auth' && signIn;
  const go = async () => {
    setBusy(true);
    setSay('');
    const r = await signIn(c.key).catch(e => ({ error: e.message }));
    setBusy(false);
    setSay(
      r?.error
        ? `Not opened. ${plain(r.error)}`
        : 'A sign-in window opened on the computer running the office. Log in in the browser, press Allow, then Check now.',
    );
  };
  return (
    <li>
      <div className="conn-sheet-top">
        <b>{c.label}</b>
        <span className="conn-sheet-act">
          {canSign && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={go}>
              <Icon name="key" size={14} />
              Sign in
            </button>
          )}
          <Tag level={level(c)}>{word(c)}</Tag>
        </span>
      </div>
      <div className="meta t2">
        {[
          c.health?.tools && `${c.health.tools} tools`,
          c.health?.ms && `started in ${(c.health.ms / 1000).toFixed(1)} s`,
          c.health?.at && `checked ${ago(c.health.at)}`,
        ]
          .filter(Boolean)
          .join(' \u00b7 ') || 'No check on record'}
      </div>
      {c.health?.note && <div className="meta t2">{c.health.note}</div>}
      <div className="meta t3">Used by {c.desks.join(', ')}</div>
      {say && (
        <div className="meta t2" role="status">
          {say}
        </div>
      )}
    </li>
  );
}

function Details({ used, check, signIn, onClose }) {
  const order = { failed: 0, absent: 0, missing: 1, 'needs-auth': 1, unchecked: 2, off: 3, connected: 4 };
  const rows = [...used].sort(
    (x, y) => (order[x.status] ?? 2) - (order[y.status] ?? 2) || x.label.localeCompare(y.label),
  );
  return (
    <Modal
      title="Connectors"
      sub="Every outside tool a desk uses, from the last check."
      onClose={onClose}
      width={720}
      footer={check}
    >
      <ul className="conn-sheet">
        {rows.map(c => (
          <ConnRow key={c.key} c={c} signIn={signIn} />
        ))}
      </ul>
    </Modal>
  );
}
// How many glyphs fit the room the bar leaves them; the rest fold into a "+N" whose tip lists them.
function useFit(ref, total) {
  const [fit, setFit] = useState(total);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const n = Math.floor((el.clientWidth + 2) / 32);
      setFit(n >= total ? total : Math.max(1, n - 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, total]);
  return fit;
}
export default function ConnectorStrip({ phone = false }) {
  const { used, ok, bad, unchecked } = useConnectorHealth();
  const a = useActions();
  const probing = useOffice(s => s.probing);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const listRef = useRef(null);
  const all = [...bad, ...unchecked, ...ok];
  const fit = useFit(listRef, all.length);
  if (!used.length) return null;
  const run = async () => {
    setErr('');
    const r = await a.checkConnectors();
    if (r?.error) setErr(`Not checked. ${plain(r.error)}`);
  };
  const check = (
    <Tip text="Check every connector in use, a minute or two (K)">
      <button type="button" className="btn btn-secondary btn-sm" disabled={probing} onClick={run}>
        <Icon name="refresh" size={14} />
        {probing ? 'Checking…' : 'Check now'}
      </button>
    </Tip>
  );
  const errLine = err && (
    <div className="err-line" role="alert">
      <Icon name="critical" size={14} sw={2} />
      <span>{err}</span>
    </div>
  );
  const sheet = open && (
    <Details
      used={used}
      signIn={a.signInConnector}
      check={
        <>
          {errLine}
          {check}
        </>
      }
      onClose={() => setOpen(false)}
    />
  );
  if (phone) {
    return (
      <>
        <button type="button" className="ph-conn" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Icon name="plug" size={15} />
          <span>
            {ok.length} of {used.length} connectors fine
          </span>
          {bad[0] && (
            <span className="conn-tag">
              <Tag level={level(bad[0])}>
                {short(bad[0].label)}
                {bad.length > 1 ? ` and ${bad.length - 1} more` : ''}
              </Tag>
            </span>
          )}
          <Icon name="chevron" size={16} className="t3 ph-conn-go" />
        </button>
        {sheet}
      </>
    );
  }
  return (
    <>
      <div className="statusbar" role="region" aria-label="Connectors">
        <span className="sb-lbl">
          <Icon name="plug" size={15} />
          <span className="sb-word">Connectors</span>
        </span>
        <div className="conn-list" ref={listRef}>
          <button
            type="button"
            className="conn-icons"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label={`${ok.length} of ${used.length} connectors connected${bad.length ? `, ${bad.length} need attention` : ''}${unchecked.length ? `, ${unchecked.length} not checked yet` : ''}. Open the details`}
          >
            {all.slice(0, fit).map(c => (
              <Tip key={c.key} text={tipOf(c)}>
                <span className="conn-ic" data-level={level(c)}>
                  <ConnGlyph c={c} />
                  <span className="conn-dot" />
                </span>
              </Tip>
            ))}
            {fit < all.length && (
              <Tip
                text={all
                  .slice(fit)
                  .map(c => `${short(c.label)}: ${word(c)}`)
                  .join('\n')}
              >
                <span className="conn-ic conn-more">+{all.length - fit}</span>
              </Tip>
            )}
          </button>
        </div>{' '}
        {/* one or two problems are named; more (a new install with tools not set up yet) become one tag, listed in Details */}
        {bad.length <= 2 ? (
          bad.map(c => (
            <Tip key={c.key} text={tipOf(c)}>
              <span className="conn-tag">
                <Tag level={level(c)}>
                  {short(c.label)} {word(c)}
                </Tag>
              </span>
            </Tip>
          ))
        ) : (
          <Tip text={bad.map(c => `${short(c.label)}: ${word(c)}`).join('\n')}>
            <span className="conn-tag">
              <Tag level={bad.some(c => level(c) === 'serious') ? 'serious' : 'warn'}>{bad.length} need attention</Tag>
            </span>
          </Tip>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Details
        </button>
        {check}
        {sheet}
      </div>
      {!open && err && <div className="sb-err">{errLine}</div>}
    </>
  );
}
