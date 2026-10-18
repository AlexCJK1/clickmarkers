// Talking to a desk without giving it a job. A chat reply comes from the desk's own standing prompt
// (the same cached prefix its jobs use) plus a short context: its notebook, its recent tickets, a few
// notes picked for the question. No tools in a chat: anything that needs doing goes as a job.
//
// A department lead also runs the set-up interview: five questions, one at a time; at the end Opus
// writes updated briefs for the desks the answers touch and one skill, after backing up what it changes.
import fs from 'node:fs';
import path from 'node:path';
import { jsonFile } from '../core/store.mjs';
import { emit, log } from '../core/events.mjs';
import { systemPrompt, styleLine } from '../engines/prompt.mjs';
import { stamp } from '../core/clock.mjs';

const KEEP = 40;
const CHAT_RULE =
  'This is a quick chat with the owner on the office page, not a job. Answer in plain text, in your own voice as this desk, under 120 words unless he asks for more. You have no tools in a chat: answer from your brief, the notes and the tickets below. If he asks for something to be done (drafting, posting, checking a live system, pulling numbers), say in a line what you would do and tell him to send it as a job; never pretend it is done. Never invent figures.';

export const QUESTIONS = [
  'What does this department do here, in a few sentences?',
  'Walk me through the most common job, start to finish.',
  'What does a good result look like? What would make you send it back?',
  'The red lines: what must this department never do or say?',
  'Which tools, files and people does it work with?',
];
const START = /^(set ?up|onboard|interview me|teach the team|run the set-?up interview)[\s.!]*$/i;

export class Chat {
  constructor(office) {
    this.office = office;
    this.dir = path.join(office.cfg.data, 'chats');
    this.iv = jsonFile(path.join(office.cfg.data, 'interviews.json'), { open: {}, done: {} });
    this.writing = new Set(); // departments whose write-up is running
  }
  file(id) {
    return path.join(this.dir, `${String(id).replace(/[^a-z0-9_-]/gi, '')}.json`);
  }
  history(id) {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8')).messages || [];
    } catch {
      return [];
    }
  }
  save(id, messages) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(id), JSON.stringify({ messages: messages.slice(-KEEP) }, null, 1));
  }
  clear(id) {
    try {
      fs.unlinkSync(this.file(id));
    } catch {
      // nothing to clear
    }
  }
  /** Is this desk a department lead (the one who interviews)? Returns the department or null. */
  leads(id) {
    return this.office.company.departments.find(d => d.lead === id) || null;
  }
  interviewState(dept) {
    return this.iv.read().open[dept] || null;
  }
  setUp(dept) {
    const s = this.iv.read();
    return !!s.done[dept];
  }

  async say(id, text) {
    const o = this.office;
    const desk = o.company.agent(id);
    if (!desk) throw new Error(`no desk called ${id}`);
    text = String(text || '').trim();
    if (!text) throw new Error('say something');
    const messages = this.history(id);
    const add = (role, t, extra = {}) => {
      messages.push({ role, text: t, at: Date.now(), ...extra });
    };
    add('user', text);
    let reply = '',
      extra = {};
    const dept = this.leads(id);
    const job = text.match(/^(?:job|task)\s*:\s*(.+)$/is);
    if (dept && (this.interviewState(dept.id) || START.test(text)))
      ({ reply, extra } = await this.interview(dept, desk, text));
    else if (job) {
      const t = await o.submit({ text: job[1], agent: id, by: 'owner' });
      reply =
        t.agent === id
          ? `On it as a job: "${t.title}". It shows under this desk and the result lands there.`
          : `${desk.name} takes no jobs, so I passed this to ${o.company.agent(t.agent)?.name || t.agent} as "${t.title}".`;
      extra = { ticket: t.id };
    } else ({ reply, extra } = await this.answer(desk, text, messages.slice(0, -1)));
    add('assistant', reply, extra);
    this.save(id, messages);
    emit('say', { agent: id, text: reply.slice(0, 300), chat: true });
    return { reply, ...extra, messages: messages.slice(-KEEP) };
  }

  async answer(desk, text, earlier) {
    const o = this.office;
    const system = systemPrompt({
      company: o.company,
      agent: desk,
      connectors: o.connectors,
      vault: o.vault,
      officeTools: [],
    });
    const mine = o.tickets
      .all({ agent: desk.id })
      .slice(0, 6)
      .map(
        t =>
          `- [${t.state}] ${t.title}${
            t.result || t.draft
              ? `: ${String(t.result || t.draft)
                  .replace(/\s+/g, ' ')
                  .slice(0, 300)}`
              : ''
          }`,
      );
    const nb = o.vault.notebook(desk.id, 1500);
    const notes = o.vault.relevant(text, [], 3).map(n => n.slice(0, 1800));
    const user = [
      `Now: ${stamp(Date.now(), o.cfg.timezone)}.`,
      CHAT_RULE,
      nb ? `## Your notebook\n${nb}` : '',
      mine.length ? `## Your recent tickets (newest first)\n${mine.join('\n')}` : '## Your recent tickets\nnone yet',
      notes.length ? `## Notes that may help\n${notes.join('\n\n')}` : '',
      `## The owner says\n${text}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    // earlier turns as real turns, starting with the owner, alternating
    const turns = [];
    for (const m of earlier.slice(-8)) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (!turns.length && role !== 'user') continue;
      if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += '\n' + m.text;
      else turns.push({ role, content: m.text });
    }
    if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
    const r = await o.quick({
      system,
      user,
      model: desk.model,
      maxTokens: 1200,
      agent: desk.id,
      dept: desk.dept,
      phase: 'chat',
      effort: 'low',
      history: turns,
    });
    if (!r || !r.text)
      return {
        reply: 'I could not answer just now (no model lane answered). Try again in a minute.',
        extra: { error: true },
      };
    return { reply: r.text, extra: { lane: r.lane } };
  }

  /* ---------- the set-up interview ---------- */
  async interview(dept, lead, text) {
    const st = this.iv.read();
    const cur = st.open[dept.id];
    if (!cur) {
      st.open[dept.id] = { step: 0, answers: [], lead: lead.id, at: Date.now() };
      this.iv.write(st);
      return {
        reply: `Set-up interview for ${dept.name}: five questions, one at a time. At the end I write updated briefs for the desks your answers touch and one skill, and I back up what I change first. Say "skip" to pass on a question, "done" to finish early, "cancel" to stop with nothing written.\n\n1/5. ${QUESTIONS[0]}`,
        extra: { interview: 1 },
      };
    }
    if (this.writing.has(dept.id))
      return {
        reply: 'Still writing up your answers. It takes a minute; nothing else is taken in meanwhile.',
        extra: { interview: 0, busy: true },
      };
    if (/^cancel\b/i.test(text)) {
      delete st.open[dept.id];
      this.iv.write(st);
      return { reply: 'Stopped. Nothing was written.', extra: { interview: 0 } };
    }
    const answered = cur.step >= QUESTIONS.length; // all five in: a failed write-up is tried again, with the same answers
    if (!answered && START.test(text))
      return {
        reply: `We are on question ${cur.step + 1} of 5. ${QUESTIONS[cur.step]}`,
        extra: { interview: cur.step + 1 },
      };
    const finish = answered || /^done\b/i.test(text);
    if (!finish) {
      cur.answers[cur.step] = /^skip\b/i.test(text) ? '' : text;
      cur.step++;
    }
    if (!finish && cur.step < QUESTIONS.length) {
      this.iv.write(st);
      return { reply: `${cur.step + 1}/5. ${QUESTIONS[cur.step]}`, extra: { interview: cur.step + 1 } };
    }
    if (!cur.answers.some(a => String(a || '').trim())) {
      delete st.open[dept.id];
      this.iv.write(st);
      return { reply: 'No answers, so nothing to write. Say "set up" to start again.', extra: { interview: 0 } };
    }
    cur.step = QUESTIONS.length;
    this.iv.write(st);
    this.writing.add(dept.id);
    const out = await this.writeUp(dept, lead, cur.answers)
      .catch(e => ({ error: e.message }))
      .finally(() => this.writing.delete(dept.id));
    const st2 = this.iv.read();
    if (out.error)
      return {
        reply: `I could not write it up: ${out.error}. Your answers are kept: say "set up" (or anything) to try the write-up again, or "cancel" to drop them.`,
        extra: { interview: 0, error: true },
      };
    delete st2.open[dept.id];
    st2.done[dept.id] = Date.now();
    this.iv.write(st2);
    return { reply: out.reply, extra: { interview: 0, wrote: out.wrote } };
  }

  /** Opus turns the answers into briefs and one skill; the office writes them after a backup. */
  async writeUp(dept, lead, answers) {
    const o = this.office;
    const desks = o.company.desks(dept.id);
    const system =
      'You set up a department in an office of AI desks from the owner\'s interview answers. Answer with JSON only:\n{"briefs":{"<desk id>":"<the full updated standing brief>"},"skill":{"name":"<kebab-case, 3 to 40 chars>","description":"<one line: when to use it>","desks":["<desk id>"],"steps":"<numbered steps>","shape":"<what the finished thing looks like>","rules":"<bullet rules>","template":"<optional skeleton of the output, or empty>"},"summary":"<two or three sentences for the owner: what you changed>","tryThis":"<one job he could send now to see it work>"}\nRules: brief only the desks the answers touch, always including the lead. Keep every line of a current brief unless an answer contradicts it, and add at most six sentences to it. Facts and figures only from the answers or the current briefs, never invented. ' +
      styleLine(o.company) +
      " The skill is the department's most common job done the owner's way.";
    const user = `Department: ${dept.name} (${dept.id}). Lead: ${lead.id}.\n\nDesks now:\n${desks.map(d => `### ${d.id} | ${d.name} | ${d.role}\ndoes: ${d.does || ''}\nbrief: ${d.brief || ''}`).join('\n\n')}\n\nThe owner's answers:\n${QUESTIONS.map((q, i) => `${i + 1}. ${q}\n${answers[i] ? answers[i] : '(skipped)'}`).join('\n\n')}`;
    const r = await o.quick({
      system,
      user,
      model: 'opus',
      maxTokens: 6000,
      agent: lead.id,
      dept: dept.id,
      phase: 'interview',
      effort: 'medium',
    });
    const m = String(r?.text || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no answer from the model');
    const j = JSON.parse(m[0]);
    const ids = new Set(desks.map(d => d.id));
    const briefs = Object.entries(j.briefs || {}).filter(
      ([id, b]) => ids.has(id) && String(b || '').trim().length > 20,
    );
    const sk = j.skill || {};
    const name = String(sk.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    if (!briefs.length && !/^[a-z0-9-]{3,40}$/.test(name)) throw new Error('the write-up had no usable brief or skill');
    // back up the company file, then save each brief
    const bdir = path.join(o.cfg.data, 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
    let bak = path.join(bdir, `company-${ts}.json`);
    for (let n = 2; fs.existsSync(bak); n++) bak = path.join(bdir, `company-${ts}-${n}.json`);
    fs.copyFileSync(o.cfg.company, bak);
    const wrote = [];
    for (const [id, b] of briefs) {
      o.company.save(id, { brief: String(b).trim() });
      wrote.push(`brief: ${o.company.agent(id)?.name || id}`);
    }
    if (/^[a-z0-9-]{3,40}$/.test(name)) {
      const dir = path.join(o.cfg.brain, 'skills', name);
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'SKILL.md');
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, `SKILL.${ts}.md`));
      fs.writeFileSync(
        f,
        [
          `---`,
          `name: ${name}`,
          `description: ${String(sk.description || '')
            .replace(/\n/g, ' ')
            .slice(0, 200)}`,
          `---`,
          '',
          `# ${name}`,
          '',
          '## Steps',
          String(sk.steps || '').trim(),
          '',
          '## Shape',
          String(sk.shape || '').trim(),
          '',
          '## Rules',
          String(sk.rules || '').trim(),
          '',
        ].join('\n'),
      );
      if (String(sk.template || '').trim())
        fs.writeFileSync(path.join(dir, 'template.md'), String(sk.template).trim() + '\n');
      const on = (Array.isArray(sk.desks) ? sk.desks : []).filter(id => ids.has(id));
      if (!on.includes(lead.id)) on.push(lead.id);
      for (const id of on) {
        const a = o.company.agent(id);
        if (a && !(a.skills || []).includes(name)) o.company.save(id, { skills: [...(a.skills || []), name] });
      }
      wrote.push(`skill: ${name} (on ${on.map(id => o.company.agent(id)?.name || id).join(', ')})`);
    }
    emit('board', { agent: lead.id, change: 'interview', dept: dept.id });
    log.info(`interview ${dept.id}: ${wrote.join('; ')}`);
    return {
      wrote,
      reply: `${String(j.summary || 'Done.').trim()}\n\nWritten: ${wrote.join('; ')}. The old company file is backed up in data/backups.${j.tryThis ? `\n\nTry this: ${String(j.tryThis).trim()}` : ''}`,
    };
  }
}
