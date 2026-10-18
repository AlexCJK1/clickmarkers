// Telemetry: the right-hand column. The paid ads first (cost per chat against its target, spend against
// the daily budget, spend by ad), then the leads and the Page. Every figure comes from /api/stats through
// lib/stats.js; a figure the file lacks says so instead of showing 0. Under four tracked days a series is
// stated as figures, never drawn as a chart.
import React, { useMemo, useState } from 'react';
import { useActions, useNow, useReady, useStats } from '../lib/hooks.js';
import { deriveStats, freshness } from '../lib/stats.js';
import { markUntracked, shortDate, dayLabel, chartForm } from '../lib/charts.js';
import { usd, usdShort, hm, ago, pct, plural, adName } from '../lib/format.js';
import { Empty, Icon, Meter, Skeleton, Tag, Tip } from './ui.jsx';
import { HBars, Spark } from './Charts.jsx';

/** The stats as figures, recomputed when the file changes. */
export function useFigures() { const stats = useStats(); return useMemo(() => deriveStats(stats), [stats]); }

/** "From 17:00, 24 min ago" with the failures, and Refresh (runs the stats job now). */
export function Freshness({ compact = false }) {
  const stats = useStats(); const a = useActions(); const now = useNow(30000); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const f = freshness(stats, now);
  const refresh = async () => { setBusy(true); setErr(''); const r = await a.refreshStats().catch(e => ({ error: e.message })); setBusy(false); if (r?.error) setErr(r.error); };
  const what = f.at ? `From ${hm(f.at)}, ${ago(f.at, now)}` : 'No numbers yet';
  return (
    <span className="fresh">
      {(f.failed.length > 0 || f.stale || f.old) ? <Tip text={[f.failed.length ? `Failed: ${f.failed.join('; ')}` : '', f.stale ? 'Some sources are stale.' : '', f.old ? 'The stats job has not written for a while.' : ''].filter(Boolean).join('\n')}><span tabIndex={0}><Tag level="warn">{f.failed.length ? `${plural(f.failed.length, 'source')} failed` : f.old ? `${what}` : 'Some stale'}</Tag></span></Tip> : <span>{what}</span>}
      {err && <Tip text={err}><span tabIndex={0}><Tag level="serious">Refresh failed</Tag></span></Tip>}
      <Tip text="Run the stats job now (ads, leads, the Page)"><button type="button" className={`btn btn-secondary btn-sm ${compact ? 'btn-icon' : ''}`} disabled={busy} onClick={refresh} aria-label="Refresh the numbers"><Icon name="refresh" size={14} />{compact ? null : busy ? 'Refreshing…' : 'Refresh'}</button></Tip>
    </span>
  );
}

export function CostPerChat({ F, phone = false }) {
  if (!F) return null;
  const target = F.cpcTarget;
  if (F.noChats) return (
    <div className="tile stat-tile hero edge-serious">
      <div className="lab"><span>Cost per chat · target under {usdShort(target)}</span></div>
      <div className="val">No chats yet</div>
      <div className="sub">{usd(F.spendAll)} spent across {plural(F.adCount || 0, 'ad')}{F.campaignSince ? ` since ${shortDate(F.campaignSince)}` : ''}{phone ? '' : `, and no one has started a chat.${F.linkClicksToday != null ? ` ${plural(F.linkClicksToday, 'link click')} today.` : ''}`}</div>
      <div className="row" style={{ marginTop: 12 }}><Tag level="serious">No chats from paid ads</Tag>{!phone && F.updatedAt && <span className="cap">Meta, {hm(F.updatedAt)}</span>}</div>
    </div>
  );
  const v = F.costPerChat; const over = v != null && v > target;
  return (
    <div className={`tile stat-tile hero ${over ? 'edge-serious' : ''}`}>
      <div className="lab"><span>Cost per chat · target under {usdShort(target)}</span></div>
      <div className="val">{v != null ? usd(v) : 'No figure yet'}</div>
      <div className="sub">{F.chatsAll != null ? `${plural(F.chatsAll, 'chat')} from ${plural(F.adCount || 0, 'ad')}, ${usd(F.spendAll)} spent` : 'The stats file has no chat count yet.'}</div>
      {v != null && <div className="row" style={{ marginTop: 12 }}>{over ? <Tag level="serious">{(v / target).toFixed(1)} times the target</Tag> : <Tag level="good">On target</Tag>}</div>}
    </div>
  );
}

export function SpendToday({ F, phone = false }) {
  const has = F?.spendToday != null; const b = F?.budget;
  return (
    <div className="tile stat-tile">
      <div className="lab"><span>Spend today</span></div>
      <div className="val">{has ? usd(F.spendToday) : 'n/a'}{has && b && !phone && <small>of {usdShort(b)}</small>}</div>
      {has && b ? <Meter value={F.spendToday} max={b} tone={F.spendToday > b ? 'crit' : ''} label="Spend today against the daily budget" className="tile-meter" /> : null}
      {!phone && <div className="figs"><div><span>Link clicks</span><b>{F?.linkClicksToday ?? 'n/a'}</b></div><div><span>Chats started</span><b>{F?.chatsToday ?? 'n/a'}</b></div></div>}
      {has && b ? <div className="foot">{phone ? `of ${usdShort(b)} budget` : `${pct(F.spendToday, b)}% of the daily budget`}</div> : null}
    </div>
  );
}

/** "5 to 10 Oct", "28 Sep to 3 Oct", "9 Oct". */
const span = (a, b) => { if (a === b) return shortDate(a); const [x, y] = [shortDate(a), shortDate(b)]; return x.split(' ')[1] === y.split(' ')[1] ? `${x.split(' ')[0]} to ${y}` : `${x} to ${y}`; };
function SpendWeek({ F }) {
  const d = F?.spendDays; const today = F?.today;
  const days = d ? d.dates.map((date, i) => ({ date, v: d.values[i] })).filter(x => x.date !== today).slice(-7) : [];
  const tracked = days.filter((x, i) => d && d.dates.indexOf(x.date) >= F.spendFrom);
  const before = days.filter(x => !tracked.includes(x));
  const values = useMemo(() => (d ? markUntracked(d.values, F.spendFrom) : []), [d, F?.spendFrom]);
  return (
    <div className="tile stat-tile">
      <div className="lab"><span>Spend, last 7 days</span></div>
      <div className="val">{F?.spend7 != null ? usd(F.spend7) : 'n/a'}</div>
      {chartForm(values.slice(0, -1)) === 'columns' ? <div style={{ marginTop: 12 }}><Spark values={values} /></div> : (
        <div className="figs" style={{ marginTop: 12 }}>
          {tracked.slice(-3).reverse().map(x => <div key={x.date}><span>{dayLabel(x.date)}</span><b>{usd(x.v)}</b></div>)}
          {before.length > 0 && <div><span>{span(before[0].date, before[before.length - 1].date)}</span><em>No campaign</em></div>}
        </div>
      )}
      {F?.spendToday != null && <div className="foot">Full days only, so today's {usd(F.spendToday)} is not in it yet</div>}
    </div>
  );
}

export function SpendByAd({ F, wide = false }) {
  if (!F?.byAd?.length) return null;
  const top = F.byAd[0]; const share = F.spendAll ? Math.round((100 * top.spend) / F.spendAll) : 0;
  return (
    <div className="tile stat-tile">
      <div className="lab"><span>Spend by ad, all time</span><span className="t3">{usd(F.spendAll)} in all</span></div>
      <div style={{ marginTop: 12 }}><HBars label="Spend by ad" rows={F.byAd.map(x => ({ key: x.name, name: x.name, sub: wide ? `${x.impressions.toLocaleString('en-GB')} impressions` : null, value: x.spend, text: usd(x.spend) }))} /></div>
      <div className="note" style={{ marginTop: 12 }}><Icon name="info" size={14} /><span>{F.chatsAll === 0 ? `0 chats from any of the ${F.byAd.length} ads` : `${plural(F.chatsAll, 'chat')} from ${plural(F.byAd.length, 'ad')}`}{share >= 60 ? `. "${adName(top.name)}" carries ${share}% of the spend.` : ''}</span></div>
    </div>
  );
}

export function LeadsToday({ F, phone = false }) {
  const values = useMemo(() => (F?.leadDays ? markUntracked(F.leadDays.values, F.leadTracked) : []), [F]);
  return (
    <div className="tile stat-tile">
      <div className="lab"><span>New leads today</span></div>
      <div className="val">{F?.leadsToday ?? 'n/a'}{!phone && F?.leads7 != null && <small>{F.leads7} in 7 days</small>}</div>
      {values.length > 0 && <div style={{ marginTop: 10 }}><Spark values={values} height={phone ? 26 : 30} maxBar={phone ? 6 : 8} /></div>}
      {!phone && F?.leadDays && F.leadTracked > 0 && F.leadTracked < F.leadDays.dates.length && <div className="foot">Tracking began {shortDate(F.leadDays.dates[F.leadTracked])}</div>}
    </div>
  );
}
export function Waiting({ F, phone = false }) {
  return (
    <div className={`tile stat-tile ${F?.waiting > 0 ? 'edge-warn' : ''}`}>
      <div className="lab"><span>Waiting on you</span></div>
      <div className="val">{F?.waiting ?? 'n/a'}{!phone && F?.waiting != null && <small>{F.waiting === 1 ? 'lead handed over' : 'leads handed over'}</small>}</div>
      {F?.waiting > 0 && <div className="row" style={{ marginTop: 8 }}><Tag level="warn">{phone ? 'Reply' : 'Reply needed'}</Tag></div>}
      {!phone && <div className="foot">{F?.leadSource ? `In ${F.leadSource}` : 'Leads waiting for your reply'}</div>}
    </div>
  );
}
export function Stuck({ F, phone = false }) {
  return <div className="tile stat-tile"><div className="lab"><span>Stuck leads</span></div><div className="val">{F?.stuck ?? 'n/a'}</div>{phone ? <div className="foot">{F?.stuckDays ?? 2} days or more</div> : <div className="sub">No reply for {F?.stuckDays ?? 2} days or more</div>}</div>;
}
function Posts({ F }) {
  return <div className="tile stat-tile"><div className="lab"><span>Posts booked</span></div><div className="val">{F?.posts ?? 'n/a'}</div><div className="sub">Scheduled on the Page</div></div>;
}

export default function Telemetry() {
  const F = useFigures(); const a = useActions(); const stats = useStats(); const ready = useReady();
  return (
    <section className="panel tele" aria-labelledby="tele-t">
      <div className="panel-h"><h2 id="tele-t" className="title-l">Telemetry</h2><span className="aside"><Freshness /></span></div>
      <div className="tele-body">
        {!ready ? <Skeleton rows={[150, 170, 200, 150]} /> : !F ? <Empty icon="numbers" title="No numbers yet">{stats?.error === 'no stats file' || !stats ? 'The stats job writes them every 30 minutes. Refresh runs it now.' : String(stats.error)}</Empty> : (
          <>
            <div className="sec"><h3 className="title-s">Meta ads</h3>{F.campaign && <Tip text={F.campaign}><span className="aside">{F.campaign}</span></Tip>}</div>
            <CostPerChat F={F} />
            <div className="tiles"><SpendToday F={F} /><SpendWeek F={F} /></div>
            <SpendByAd F={F} />
            <div className="sec"><h3 className="title-s">Leads and the Page</h3><span className="aside">{[F.leadSource, F.updatedAt && hm(F.updatedAt)].filter(Boolean).join(' · ')}</span></div>
            <div className="tiles"><LeadsToday F={F} /><Waiting F={F} /><Stuck F={F} /><Posts F={F} /></div>
            <button type="button" className="btn btn-ghost more-link" onClick={() => a.drawer('numbers')}><Icon name="numbers" size={15} />Every chart, full size<span className="kbd">N</span></button>
          </>
        )}
      </div>
    </section>
  );
}
