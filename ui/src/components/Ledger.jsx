// The ledger: what the office has cost to run, by day, by desk and by run, in US dollars as the API bills
// them. Under four days the days are stated as figures beside a lit 3D pair of columns; from the fourth
// day the daily charts appear.
import React, { useMemo } from 'react';
import { useActions, useIsPhone, useLedger, useSeries } from '../lib/hooks.js';
import { useOffice, deskName } from '../lib/store.js';
import { daySlots, chartForm, shortDate, dayLabel, isoDay, niceTicks } from '../lib/charts.js';
import { usd, usdShort, dur, hm, kilo, modelName, dayHeading, plural, pct } from '../lib/format.js';
import { Sheet } from './Sheet.jsx';
import { Columns, ColumnsLegend, HBars } from './Charts.jsx';
import { Empty, Icon } from './ui.jsx';
import Hero from '../floor/Hero.jsx';
import { ledgerHero } from '../floor/heroes.js';

const tokensOf = t => (t ? (t.in || 0) + (t.out || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) : 0);

function TwoColumns({ yesterday, today, yLabel }) {
  const max = Math.max(yesterday, today, 0.01);
  return <div className="fallback-cols" aria-hidden="true">{[[yesterday, yLabel, false], [today, 'Today so far', true]].map(([v, l, sofar]) => <div key={l}><b className="tnum">{usd(v)}</b><i className={sofar ? 'sofar' : ''} style={{ height: `${Math.max(2, (v / max) * 150)}px` }} /><span>{l}</span></div>)}</div>;
}

export default function Ledger() {
  const a = useActions(); const ledger = useLedger(); const series = useSeries(); const names = useOffice(s => (x => deskName(s, x))); const phone = useIsPhone();
  const view = useMemo(() => {
    if (!ledger) return null;
    const today = ledger.today || {}; const todayIso = today.day || isoDay(Date.now());
    const days = series?.days || []; const ti = days.indexOf(todayIso); const yi = ti > 0 ? ti - 1 : -1;
    const y = yi >= 0 ? { day: days[yi], usd: series.total[yi], runs: series.runs[yi], est: series.est[yi] } : null;
    const slots = n => daySlots(days, n, { n: 14, today: todayIso });
    const spend = slots(series?.total || []); const runs = slots(series?.runs || []);
    const byDesk = Object.entries(today.byAgent || {}).sort((p, q) => q[1] - p[1]);
    const todayRuns = (ledger.recent || []).filter(r => r.day === todayIso);
    const byModel = {}; for (const r of todayRuns) { const k = modelName(r.model); (byModel[k] ||= { runs: 0, usd: 0 }); byModel[k].runs++; byModel[k].usd += r.usd || 0; }
    const ENGINE = { agent: 'Agent engine', oneshot: 'Direct calls', batch: 'Batch, half price', openrouter: 'OpenRouter' };
    const byEngine = {}; for (const r of todayRuns) { const k = ENGINE[r.engine] || 'Other'; (byEngine[k] ||= { runs: 0, usd: 0 }); byEngine[k].runs++; byEngine[k].usd += r.usd || 0; }
    return { today, todayIso, y, spend, runs, byDesk, byModel: Object.entries(byModel).sort((p, q) => q[1].usd - p[1].usd), lanes: Object.entries(byEngine).sort((p, q) => q[1].usd - p[1].usd), tracked: days.length, first: days[0] };
  }, [ledger, series]);
  if (!view) return <Sheet title="Ledger" size="lg" onClose={() => a.drawer(null)}><Empty icon="ledger" title="Reading the ledger" /></Sheet>;
  const { today, y } = view; const ceiling = ledger.ceilingUsd;
  const form = chartForm(view.spend.map(s => s.value));
  const recent = (ledger.recent || []).slice(0, 25); let lastDay = '';
  return (
    <Sheet title="Ledger" size="lg" onClose={() => a.drawer(null)} sub="What the office has cost to run, by day, by desk and by run. All figures in US dollars, as the API bills them.">
      <section className="led-hero" aria-label="API spend">
        <div className="led-figs">
          <div className="cap">API spend</div>
          <div className="led-big">
            {y && <><span><span className="led-k">{dayHeading(Date.parse(`${y.day}T12:00:00`))}</span><b className="tnum">{usd(y.usd)}</b></span><span className="led-sep" /></>}
            <span><span className="led-k">Today</span><b className="tnum">{usd(today.usd)}<em>so far</em></b></span>
          </div>
          <div className="led-rows">
            <div><span className="t3">Daily ceiling</span><b className="tnum">{usdShort(ceiling)}</b><span className="t3">today at {pct(today.usd, ceiling)}%</span></div>
            <div><span className="t3">Runs</span><b className="tnum">{y ? `${y.runs} yesterday · ` : ''}{today.runs} today</b></div>
            <div><span className="t3">Left today</span><b className="tnum">{usd(Math.max(0, ceiling - (today.usd || 0)))}</b><span className="t3">past the ceiling, jobs wait until midnight</span></div>
          </div>
          {form !== 'columns' && <div className="note" style={{ marginTop: 14 }}><Icon name="info" size={14} /><span>The ledger began on {shortDate(view.first || view.todayIso)}, so there {view.tracked === 1 ? 'is 1 day' : `are ${view.tracked} days`} to show. Daily charts appear from the 4th day.</span></div>}
        </div>
        {!phone && (
          <Hero className="led-3d" label={`Yesterday ${usd(y?.usd || 0)}, today so far ${usd(today.usd)}`} deps={[y?.usd, today.usd]}
            make={host => ledgerHero(host, { yesterday: y?.usd || 0, today: today.usd || 0 })}
            fallback={<TwoColumns yesterday={y?.usd || 0} today={today.usd || 0} yLabel={y ? dayLabel(y.day) : 'Yesterday'} />}>
            {p => <>{y && <div className="hl" style={{ left: p.y.x, top: p.y.y }}><b>{usd(y.usd)}</b><span>{dayLabel(y.day)}</span></div>}<div className="hl" style={{ left: p.t.x, top: p.t.y }}><b>{usd(today.usd)}</b><span>Today so far</span></div>{niceTicks(Math.max(y?.usd || 0, today.usd || 0, 0.01)).slice(1).map((v, i) => p[`k${i}`] && <div key={v} className="hl tick" style={{ left: p[`k${i}`].x, top: p[`k${i}`].y }}><span>${+v.toFixed(2)}</span></div>)}</>}
          </Hero>
        )}
      </section>
      {form === 'columns' && (
        <section className="led-charts">
          <div><div className="sec"><h3 className="title-s">API spend per day</h3><span className="aside">14 days</span></div><Columns label="API spend per day, 14 days" values={view.spend.map(s => s.value)} dates={view.spend.map(s => s.date)} fmt={v => usd(v)} tickFmt={v => `$${v}`} height={200} /><ColumnsLegend /></div>
          <div><div className="sec"><h3 className="title-s">Runs per day</h3><span className="aside">every engine</span></div><Columns label="Runs per day, 14 days" values={view.runs.map(s => s.value)} dates={view.runs.map(s => s.date)} height={160} /></div>
        </section>
      )}
      <div className="led-cols">
        <div>
          <div className="sec"><h3 className="title-s">Today by desk</h3><span className="aside">{usd(today.usd)} across {plural(view.byDesk.length, 'desk')}</span></div>
          {view.byDesk.length ? <HBars label="API spend today by desk" gap={12} rows={view.byDesk.map(([id, v]) => ({ key: id, name: names(id), value: v, text: usd(v, 3) }))} /> : <p className="meta t3">No API spend yet today.</p>}
          <div className="sec" style={{ marginTop: 28 }}><h3 className="title-s">Today by model and lane</h3></div>
          <table className="tbl mini"><thead><tr><th scope="col"><span className="sr-only">Model or engine</span></th><th scope="col" className="r">Runs</th><th scope="col" className="r">Cost</th></tr></thead>
            <tbody>{view.byModel.map(([k, v]) => <tr key={k}><td className="strong">{k}</td><td className="r tnum">{v.runs}</td><td className="r tnum">{usd(v.usd, 3)}</td></tr>)}{view.lanes.map(([k, v], i) => <tr key={k} className={i === 0 ? 'sep' : ''}><td className="strong">{k}</td><td className="r tnum">{v.runs}</td><td className="r tnum">{usd(v.usd, 3)}</td></tr>)}</tbody></table>
        </div>
        <div className="runs-wrap">
          <div className="sec"><h3 className="title-s">Recent runs</h3><span className="aside">{recent.length} of {(ledger.recent || []).length} · newest first</span></div>
          <div className="tbl-scroll">
            <table className="tbl"><thead><tr><th scope="col">Time</th><th scope="col">Desk</th>{!phone && <th scope="col">Engine</th>}<th scope="col">Model</th><th scope="col" className="r">Cost</th>{!phone && <><th scope="col" className="r">Duration</th><th scope="col" className="r">Tokens</th></>}</tr></thead>
              <tbody>{recent.map((r, i) => { const head = r.day !== lastDay; lastDay = r.day; return <React.Fragment key={i}>{head && <tr className="grp"><td colSpan={phone ? 4 : 7}>{dayHeading(r.at)}</td></tr>}<tr><td className="tnum">{hm(r.at)}</td><td className="strong">{names(r.agent)}</td>{!phone && <td>{({ agent: 'Agent', oneshot: 'Direct', batch: 'Batch', openrouter: 'OpenRouter' })[r.engine] || r.engine || ''}</td>}<td>{modelName(r.model)}</td><td className="r tnum">{usd(r.usd, 3)}</td>{!phone && <><td className="r tnum">{r.ms ? dur(r.ms) : ''}</td><td className="r tnum">{kilo(tokensOf(r.tokens))}</td></>}</tr></React.Fragment>; })}</tbody></table>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
