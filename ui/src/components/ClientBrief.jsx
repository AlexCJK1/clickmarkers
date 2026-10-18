// The brief for one desk: the knobs that exist on it. The standing brief, the one-line "does", the
// model and effort, the daily budget on the API, the licence to send, the web and the connectors. Saving
// writes company.json; the office picks it up on the next run.
import React, { useState } from 'react';
import { useActions, useConnectors } from '../lib/hooks.js';
import { Modal } from './Sheet.jsx';
import { Field, Icon, Seg } from './ui.jsx';
import { usdShort } from '../lib/format.js';

export default function ClientBrief({ agent, onClose, onSaved }) {
  const a = useActions(); const registry = useConnectors();
  const [brief, setBrief] = useState(agent.brief || ''); const [does, setDoes] = useState(agent.does || '');
  const [model, setModel] = useState(agent.model || 'opus'); const [effort, setEffort] = useState(agent.effort || ''); const [budget, setBudget] = useState(agent.budgetUsd ?? 2);
  const [outbound, setOutbound] = useState(!!agent.outbound); const [web, setWeb] = useState(!!agent.web); const [tools, setTools] = useState(agent.tools || []);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const usable = registry.filter(c => !c.disabled);
  const budgets = [...new Set([1, 2, 3, 5, 8, +budget].filter(Number.isFinite))].sort((x, y) => x - y);
  const save = async () => {
    setBusy(true); setErr('');
    const r = await a.saveAgent(agent.id, { brief, does, model, effort, budgetUsd: +budget, outbound, web, tools }).catch(e => ({ error: e.message }));
    setBusy(false); if (r?.error) setErr(r.error); else onSaved();
  };
  const name = agent.name ? agent.name.charAt(0) + agent.name.slice(1).toLowerCase() : agent.id;
  return (
    <Modal title={`Brief: ${name}`} sub={agent.role && agent.role.toLowerCase() !== name.toLowerCase() ? agent.role : undefined} onClose={onClose} width={720}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={save}><Icon name="check" size={15} sw={2.2} />{busy ? 'Saving…' : 'Save the brief'}</button></>}>
      <Field label="What this desk does, in one line"><input className="field" value={does} onChange={e => setDoes(e.target.value)} /></Field>
      <Field label="The standing brief" hint="The desk's standing instructions, sent with every job."><textarea className="field" rows={8} value={brief} onChange={e => setBrief(e.target.value)} /></Field>
      <div className="brief-grid">
        <div className="fld"><span className="fld-l" id="cb-model">Model</span><Seg label="Model" value={model} onChange={setModel} options={[['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus 5.5']]} /><div className="fld-h">Haiku to sort and extract, Sonnet for routing and digests, Opus 5.5 for desks that think.</div></div>
        <div className="fld"><span className="fld-l">Effort</span><Seg label="Effort" value={effort} onChange={setEffort} options={[['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high']]} /><div className="fld-h">How hard the model thinks. Default is the model's own (medium on Opus 5.5).</div></div>
        <div className="fld"><span className="fld-l">Daily budget on the API</span><Seg label="Daily budget" value={+budget} onChange={setBudget} options={budgets.map(v => [v, usdShort(v)])} /><div className="fld-h">Past it, the desk's jobs wait until midnight.</div></div>
        <div className="fld"><span className="fld-l">Licence to send</span><Seg label="Licence to send" value={outbound} onChange={setOutbound} options={[[false, 'Never'], [true, 'With your OK']]} /><div className="fld-h">Drafts always come first; this lets the approved draft go out.</div></div>
        <div className="fld"><span className="fld-l">The web</span><Seg label="The web" value={web} onChange={setWeb} options={[[false, 'No'], [true, 'Search and read']]} /></div>
      </div>
      <div className="fld"><span className="fld-l">Connectors on the desk</span>
        <div className="toggles" role="group" aria-label="Connectors on the desk">{usable.map(c => { const on = tools.includes(c.key); return <button key={c.key} type="button" className="toggle" aria-pressed={on} onClick={() => setTools(on ? tools.filter(k => k !== c.key) : [...tools, c.key])}>{on && <Icon name="check" size={13} sw={2.2} />}{c.label}{c.missing?.length ? ' (needs a key)' : ''}</button>; })}</div>
      </div>
      {err && <div className="err-line" role="alert"><Icon name="critical" size={14} sw={2} /><span>{err}</span></div>}
    </Modal>
  );
}
