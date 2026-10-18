// Numbers: every chart from the stats job, full size. Leads and link clicks per day over fixed day slots
// (the days before tracking began are hatched, never zeros), clicks by channel, where every lead stands in
// the pipeline (with the leads as glass marbles), and the paid ads.
import React, { useMemo, useState } from 'react';
import { useActions, useIsPhone } from '../lib/hooks.js';
import { markUntracked, sumLast, shortDate, dayLabel, chartForm, isoDay } from '../lib/charts.js';
import { usd, usdShort, plural, sentence, int, adName } from '../lib/format.js';
import { Sheet } from './Sheet.jsx';
import { Columns, ColumnsLegend, HBars, Figures } from './Charts.jsx';
import { Empty, Icon, Seg, Tag } from './ui.jsx';
import { Freshness, useFigures } from './Telemetry.jsx';
import Hero from '../floor/Hero.jsx';
import { pipelineHero } from '../floor/heroes.js';

function DayChart({ title, aside, series, tracked, n, kpi, kpiNote, label, foot, fmt }) {
  const values = useMemo(() => (series ? markUntracked(series.values, tracked).slice(-n) : []), [series, tracked, n]);
  const dates = series ? series.dates.slice(-n) : [];
  const form = chartForm(values);
  return (
    <section className="card2">
      <div className="card2-hd"><h3 className="title-s">{title}</h3><span className="aside meta t3">{aside}</span></div>
      <div className="kpi"><span className="big tnum">{kpi}</span><span className="meta">{kpiNote}</span></div>
      {form === 'columns' ? <Columns label={label} values={values} dates={dates} height={236} fmt={fmt} /> : form === 'zero' ? <p className="meta t3 chart-none">Every tracked day is zero.</p> : form === 'figures' ? <Figures rows={values.map((v, i) => ({ v, d: dates[i] })).filter(x => x.v !== null).map(x => ({ label: dayLabel(x.d), value: fmt ? fmt(x.v) : x.v }))} note="Under 4 tracked days, so the figures rather than a chart." /> : <p className="meta t3 chart-none">Not tracked yet.</p>}
      {form === 'columns' && (foot || <ColumnsLegend untracked={values.some(v => v === null)} />)}
    </section>
  );
}

function Channels({ F }) {
  const [all, setAll] = useState(false);
  if (!F.channels.length) return <section className="card2"><div className="card2-hd"><h3 className="title-s">Clicks by channel</h3></div><p className="meta t3">The stats file has no tracked links yet.</p></section>;
  const links = F.channels.flatMap(c => c.links.map(l => ({ ...l, channel: c.name }))).sort((a, b) => b.clicks - a.clicks);
  return (
    <section className="card2">
      <div className="card2-hd"><h3 className="title-s">Clicks by channel</h3><span className="aside meta t3">Last 7 days</span></div>
      <div className="kpi"><span className="big tnum">{F.clicks7}</span><span className="meta">clicks on {plural(F.linkCount, 'tracked link')}</span></div>
      <div style={{ marginTop: 14 }}><HBars label="Clicks by channel, last 7 days" gap={13} minPct={1.2} rows={F.channels.map(c => ({ key: c.name, name: c.name, sub: plural(c.links.length, 'link'), value: c.clicks }))} /></div>
      <button type="button" className="btn btn-ghost show-all" aria-expanded={all} onClick={() => setAll(!all)}><Icon name={all ? 'chevronUp' : 'chevron'} size={14} />{all ? 'Hide the links' : `Show all ${F.linkCount} links`}</button>
      {all && <table className="tbl mini"><thead><tr><th scope="col">Link tag</th><th scope="col">Channel</th><th scope="col" className="r">Clicks</th></tr></thead><tbody>{links.map(l => <tr key={l.tag}><td className="strong">{l.tag}</td><td>{l.channel}</td><td className="r tnum">{l.clicks}</td></tr>)}</tbody></table>}
    </section>
  );
}

function Pipeline({ F, phone }) {
  if (!F.stages.length) return null;
  const peak = F.stages.reduce((m, s) => (s.n > m.n ? s : m), F.stages[0]);
  const hero = F.stages.slice(0, 7);
  return (
    <section className="card2 pipe">
      <div className="pipe-l">
        <div className="card2-hd"><h3 className="title-s">Where every lead is</h3><span className="aside meta t3">All {F.leadsAll} leads, by stage, all time</span></div>
        <div className="pipe-head">{F.goal && <span className="big">{F.goal.from.n} {F.goal.from.label.toLowerCase()}, {F.goal.to.n} {F.goal.to.label.toLowerCase()}</span>}{F.stuck > 0 && <Tag level="warn">{F.stuck} stuck for {F.stuckDays} days or more</Tag>}</div>
        <ol className="stages" aria-label="Leads by stage">
          {F.stages.map((s, i) => <li key={s.key} className="stg-li">{i > 0 && <span className="arr" aria-hidden="true"><Icon name="chevronRight" size={14} /></span>}<div className={`stg ${s.n ? '' : 'zero'} ${s === peak && s.n ? 'peak' : ''}`}><b className="tnum">{s.n}</b><span>{s.label}</span></div></li>)}
        </ol>
        {F.exits.length > 0 && <div className="exits"><span className="t3">Left the pipeline</span>{F.exits.map(e => <span key={e.key} className="exit"><b className="tnum">{e.n}</b> {e.label}</span>)}</div>}
      </div>
      {!phone && (
        <Hero className="pipe-3d" label={`Leads as marbles by stage: ${hero.map(s => `${s.label} ${s.n}`).join(', ')}`} deps={[hero.map(s => s.n).join(',')]} make={host => pipelineHero(host, hero)} fallback={<div className="marbles-2d" aria-hidden="true">{hero.map(s => <div key={s.key}><span className="bay">{Array.from({ length: Math.min(16, s.n) }, (_, i) => <i key={i} />)}</span><b className="tnum">{s.n}</b><span>{s.label}</span></div>)}</div>}>
          {p => hero.map(s => p[s.key] && <div key={s.key} className="hl under" style={{ left: p[s.key].x, top: p[s.key].y }}><b>{s.n}</b><span>{s.label}</span></div>)}
        </Hero>
      )}
    </section>
  );
}

function PaidAds({ F, n }) {
  if (F.spendAll == null && !F.byAd.length) return null;
  const values = F.spendDays ? markUntracked(F.spendDays.values, F.spendFrom).slice(-n) : []; const dates = F.spendDays ? F.spendDays.dates.slice(-n) : [];
  const chats14 = F.chatDays ? sumLast(F.chatDays.values, 14) : F.chatsAll;
  return (
    <section className="card2 ads-row">
      <div>
        <div className="card2-hd"><h3 className="title-s">Paid ads</h3><span className="aside meta t3">{F.campaignSince ? `Since ${shortDate(F.campaignSince)}` : ''}</span></div>
        <div className="kpi"><span className="big tnum">{usd(F.spendAll)}</span><span className="meta">spent across {plural(F.adCount || 0, 'ad')}</span></div>
        {chartForm(values) === 'columns' ? <Columns label="Ad spend per day" values={values} dates={dates} height={170} fmt={v => usd(v)} tickFmt={v => `$${v}`} /> : (
          <div className="ad-figs">
            {F.spendYesterday != null && <div><span className="t3">{dayLabel(F.yesterday)}</span><b className="tnum">{usd(F.spendYesterday)}</b></div>}
            <div><span className="t3">Today so far</span><b className="tnum">{F.spendToday != null ? usd(F.spendToday) : 'n/a'}</b></div>
            <div><span className="t3">Daily budget</span><b className="tnum">{F.budget != null ? usdShort(F.budget) : 'n/a'}</b></div>
          </div>
        )}
        <div className="ads-foot">{chats14 === 0 ? <Tag level="serious">0 chats in 14 days</Tag> : chats14 != null ? <Tag level="good">{plural(chats14, 'chat')} in 14 days</Tag> : null}{(F.linkClicksAll != null || F.impressionsAll != null) && <span className="meta t3">{[F.linkClicksAll != null && plural(F.linkClicksAll, 'link click'), F.impressionsAll != null && `${int(F.impressionsAll)} impressions`].filter(Boolean).join(', ')}</span>}</div>
      </div>
      <div>
        <div className="card2-hd"><h3 className="title-s">Spend by ad</h3><span className="aside meta t3">All time</span></div>
        <div style={{ marginTop: 8 }}><HBars label="Spend by ad, all time" gap={12} minPct={1.2} rows={F.byAd.map(x => ({ key: x.name, name: x.name, sub: `${int(x.impressions)} impressions`, value: x.spend, text: usd(x.spend) }))} /></div>
        {F.byAd.length > 0 && <div className="note" style={{ marginTop: 14 }}><Icon name="info" size={14} /><span>{F.chatsAll === 0 ? `None of the ${F.byAd.length} ads has started a chat.` : `${plural(F.chatsAll || 0, 'chat')} in all.`}{F.spendAll ? ` "${adName(F.byAd[0].name)}" carries ${Math.round((100 * F.byAd[0].spend) / F.spendAll)}% of the spend.` : ''}</span></div>}
      </div>
    </section>
  );
}

/** Any other chart the stats job writes, drawn by the same rules. */
function MoreChart({ c, F }) {
  const s = c.series?.[0]; if (!s) return null;
  const dated = (c.labels || []).length > 6 && /^\d{1,2}\/\d{1,2}$/.test(String(c.labels[0]));
  if (dated) {
    const end = new Date(`${F.today}T12:00:00`).getTime(); const dates = s.values.map((_, i) => isoDay(end - (s.values.length - 1 - i) * 86400000));
    return <section className="card2"><div className="card2-hd"><h3 className="title-s">{sentence(c.title)}</h3><span className="aside meta t3">{sentence(c.sub)}</span></div><Columns label={sentence(c.title)} values={s.values.map(Number)} dates={dates} height={200} /></section>;
  }
  return <section className="card2"><div className="card2-hd"><h3 className="title-s">{sentence(c.title)}</h3><span className="aside meta t3">{sentence(c.sub)}</span></div><HBars label={sentence(c.title)} rows={(c.labels || []).map((l, i) => ({ key: l, name: l, value: +s.values[i] || 0, text: String(s.values[i]), sub: c.notes?.[i] }))} /></section>;
}

/** The numbers themselves, for the sheet and for the phone's Numbers tab. */
export function NumbersBody({ n = 14 }) {
  const F = useFigures(); const phone = useIsPhone();
  if (!F) return <Empty icon="numbers" title="No numbers yet">The stats job writes them every 30 minutes. Refresh runs it now.</Empty>;
  return (
    <>
      <div className="nrow1">
        <DayChart title="New leads per day" aside={`${F.leadSource || 'Every lead'} · ${n} days`} series={F.leadDays} tracked={F.leadTracked} n={n} label={`New leads per day, ${n} days`} kpi={F.leads7 ?? (F.leadDays ? sumLast(F.leadDays.values, 7) : 'n/a')} kpiNote={`in the last 7 days · ${F.leadsToday ?? 0} today so far`} />
        <DayChart title="Link clicks per day" aside={`Every tracked link · ${n} days`} series={F.clickDays} tracked={F.leadTracked} n={n} label={`Link clicks per day, ${n} days`} kpi={F.clickDays ? sumLast(F.clickDays.values, 7) : 'n/a'} kpiNote={`in the last 7 days · ${F.clickDays ? F.clickDays.values[F.clickDays.values.length - 1] : 0} today so far`}
          foot={F.leadTracked > 0 && F.clickDays ? <div className="legend"><span>Tracking began {shortDate(F.clickDays.dates[F.leadTracked])}. The days before were not counted, so they are not zeros.</span></div> : null} />
        <Channels F={F} />
      </div>
      <Pipeline F={F} phone={phone} />
      <PaidAds F={F} n={n} />
      {F.more.length > 0 && <div className="nrow-more">{F.more.map(c => <MoreChart key={c.id} c={c} F={F} />)}</div>}
    </>
  );
}

export default function Numbers() {
  const a = useActions(); const F = useFigures(); const phone = useIsPhone(); const [n, setN] = useState(14);
  const sub = F ? `Leads, clicks and ad spend${F.campaign ? ` for ${F.campaign}` : ''}. Money in US dollars, as Meta bills it. The stats job keeps 14 days, so 30 days is not on offer yet.` : 'Every chart the stats job writes, full size';
  return (
    <Sheet title="Numbers" size="xl" onClose={() => a.drawer(null)} sub={sub} actions={<><Seg label="Days shown" value={n} onChange={setN} options={[[7, '7 days'], [14, '14 days']]} /><Freshness compact={phone} /></>}>
      <NumbersBody n={n} />
    </Sheet>
  );
}
