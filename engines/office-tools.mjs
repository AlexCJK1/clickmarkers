// The office's own tools, served in-process to a run: read a note, append to the notes a desk may
// write, leave a note on the ticket, delegate a child ticket to another desk, and read the files the
// owner has opened to the office. Nothing here reaches the shell.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { routable } from '../company/model.mjs';
import { fence } from '../core/guard.mjs';

const text = s => ({ content: [{ type: 'text', text: String(s) }] });
/** Every tool this server can offer a run. The evaluations check refuses to hand a desk a fix that names one. */
export const OFFICE_TOOL_NAMES = [
  'brain_read',
  'brain_append',
  'desk_note',
  'ticket_note',
  'delegate',
  'tickets_recent',
  'files_list',
  'file_read',
];
const SECRET_FILE = /(^|[\\/])(\.[^\\/]*|.*\.(pem|key|p12|pfx)|.*secrets?.*|.*\.env.*)$/i;

/**
 * The guard for the open folders. A path counts only when its real location (links followed, on both sides) is
 * inside a real root, no part of it under the root is hidden (a name that starts with a dot) or a Windows short
 * name (ENV~1 for .env), and, for a file, its name does not look like a key or a secrets file. Returns the real
 * path, or '' when refused.
 */
export function openPath(p, roots, { file = false } = {}) {
  const asked = path.resolve(String(p || ''));
  if (asked.split(/[\\/]+/).some(x => /~\d/.test(x))) return ''; // a short name hides the real one from the checks below
  let real;
  try {
    real = fs.realpathSync.native(asked);
  } catch {
    return '';
  }
  for (const root of roots) {
    let r;
    try {
      r = fs.realpathSync.native(root);
    } catch {
      continue;
    }
    const rel = path.relative(r, real);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) continue;
    const parts = rel ? rel.split(/[\\/]+/) : [];
    if (parts.some(x => x.startsWith('.') || /~\d/.test(x))) return '';
    if (file && (SECRET_FILE.test(real) || SECRET_FILE.test(asked))) return '';
    return real;
  }
  return '';
}

export function officeServer({ office, ticket, agent, phase = 'draft' }) {
  const { vault, tickets, company, cfg } = office;
  const allowed = new Set(agent.office || []);
  const writable = cfg.brain
    ? cfg.brainWritable || ['00-Meta/numbers-ledger.md', '00-Meta/log.md', '60-Accounts/open-items.md']
    : [];
  const roots = (cfg.files?.roots || []).map(r => path.resolve(cfg.root || process.cwd(), r));
  const tools = [];

  if (allowed.has('brain_read'))
    tools.push(
      tool(
        'brain_read',
        'Read a note from the office brain by name or path (for example "facts" or "40-Marketing/rulings.md"). brain_read("list") names every note.',
        { note: z.string() },
        async ({ note }) => {
          if (note === 'list') return text(`${vault.names().join('\n')}\n00-Meta/stats.json (the live numbers)`);
          // the numbers file is JSON, not a note: it is read as the lines every desk's prompt gets
          if (/^(00-Meta\/)?stats(\.json)?$/i.test(note.trim()))
            return text(
              vault.statsText(cfg.stats?.file) || 'No stats file yet: nothing writes the numbers (docs/stats.md).',
            );
          const n = vault.note(note);
          return text(n ? n.text.slice(0, 60000) : `No note called ${note}. Try brain_read("list").`);
        },
      ),
    );
  if (allowed.has('brain_append'))
    tools.push(
      tool(
        'brain_append',
        `Append dated lines to one of the notes this desk may write: ${writable.join(', ')}. Newest first under the heading.`,
        { note: z.string(), text: z.string() },
        async ({ note, text: t }) => {
          const n = vault.note(note);
          if (!n || !writable.includes(n.rel))
            return text(`Not allowed: ${note}. Writable notes: ${writable.join(', ')}`);
          vault.append(n.rel, t);
          office.events.emit('brain', { ticket: ticket.id, agent: agent.id, note: n.rel, bytes: t.length });
          return text(`Appended to ${n.rel}.`);
        },
      ),
    );
  // The notebook is in every later draft's prompt, so writing it is a power: a desk gets it only when company.json
  // lists it, and never in an execute run (that run carries out the approved steps and nothing else).
  if (allowed.has('desk_note') && phase !== 'execute')
    tools.push(
      tool(
        'desk_note',
        'Write one line into your own notebook: something you learned that the next run should know (a tag already used, a figure the owner corrected, a source that fails). It is shown to you on every run. Not for results.',
        { text: z.string() },
        async ({ text: t }) => {
          vault.noteDesk(agent.id, t, agent.name);
          office.events.emit('notebook', { agent: agent.id, ticket: ticket.id });
          return text('Noted in your notebook.');
        },
      ),
    );
  if (allowed.has('ticket_note'))
    tools.push(
      tool(
        'ticket_note',
        'Leave a short note on the current ticket (progress, a blocker, a question for the owner). It shows on the office page.',
        { text: z.string() },
        async ({ text: t }) => {
          tickets.comment(ticket.id, agent.name, t);
          return text('Noted.');
        },
      ),
    );
  if (allowed.has('delegate') && phase === 'draft') {
    // not in a wrap-up, and not after the OK: new work gets its own draft
    const desks = [...company.agents.values()]
      .filter(a => a.id !== agent.id && !a.paused && routable(a))
      .map(a => `${a.id} = ${a.name} (${a.role})`)
      .join('; ');
    tools.push(
      tool(
        'delegate',
        `Hand a piece of this task to another desk as a child ticket. The child runs on its own; when every child has finished you get a wrap-up run with all their results, so delegate everything you need in this run and then finish. When one piece needs another piece's result (a check needs the words first), give the second one the first ticket's id in "after": it waits, and the first result is put in front of it. Desk ids: ${desks}.`,
        {
          to: z.string().describe('a desk id from the list'),
          title: z.string(),
          text: z.string().describe('the full brief for that desk: what, from where, the outcome wanted'),
          after: z.string().optional().describe('ticket id this must wait for'),
          needsOk: z.boolean().optional(),
        },
        async ({ to, title, text: t, after, needsOk }) => {
          const a =
            company.agent(to) || company.byName(to) || company.lead(to) || company.lead(company.deptByWord(to)?.id);
          if (!a) return text(`No desk called ${to}. Use an id from the list.`);
          if (a.id === agent.id) return text('That is your own desk; do the work here.');
          if (!routable(a)) return text(`${a.name} takes no jobs. Pick another desk from the list.`); // by id, by name or as a department's lead
          const dep = after && tickets.get(after) ? [after] : [];
          const child = tickets.create({
            title,
            text: t,
            dept: a.dept,
            agent: a.id,
            parent: ticket.id,
            by: agent.id,
            needsOk: needsOk ?? a.outbound,
            priority: (ticket.priority || 0) + 1,
            after: dep,
          });
          office.events.emit('delegate', {
            from: agent.id,
            to: a.id,
            ticket: child.id,
            parent: ticket.id,
            after: dep[0] || '',
          });
          return text(
            `Delegated to ${a.name} as ticket ${child.id}${dep.length ? `, waiting for ${dep[0]}` : ''}. Carry on; the wrap-up run brings the results back.`,
          );
        },
      ),
    );
  }
  if (allowed.has('tickets_recent'))
    tools.push(
      tool(
        'tickets_recent',
        "The office's recent finished tickets (title, desk, state, when, the result), newest first, up to 40, for reviews and briefs. Optional: days back (default 7), desk id.",
        { days: z.number().optional(), agent: z.string().optional() },
        async ({ days = 7, agent: who }) => {
          const since = Date.now() - days * 86400000;
          const rows = tickets
            .all({ state: ['done', 'failed'], agent: who || undefined })
            .filter(t => t.updatedAt >= since && t.id !== ticket.id)
            .slice(0, 40);
          // results were written by desks, some after reading the web or the mail: fenced, so a line in one cannot pass for an order
          return text(
            rows.length
              ? fence(
                  'recent results written by desks',
                  rows
                    .map(
                      t =>
                        `### ${t.title}\n${t.agent} · ${t.state} · ${new Date(t.updatedAt).toISOString().slice(0, 16)} · ${t.lane || ''}${t.routine ? ' · routine ' + t.routine : ''}\n${String(t.result || t.error || '').slice(0, 1500)}`,
                    )
                    .join('\n\n'),
                )
              : 'No finished tickets in that window.',
          );
        },
      ),
    );
  if (allowed.has('files_list') && roots.length)
    tools.push(
      tool(
        'files_list',
        `List files under the folders the owner opened to the office: ${roots.join(', ')}.`,
        { folder: z.string().optional() },
        async ({ folder }) => {
          const dir = openPath(folder || roots[0], roots);
          if (!dir) return text(`Outside the open folders, or hidden. Open folders: ${roots.join(', ')}`);
          let ents = [];
          try {
            ents = fs.readdirSync(dir, { withFileTypes: true });
          } catch (e) {
            return text(`Cannot list ${dir}: ${e.message}`);
          }
          return text(
            ents
              .filter(e => !e.name.startsWith('.') && !/~\d/.test(e.name))
              .map(
                e =>
                  `${e.isDirectory() ? '[dir] ' : e.isSymbolicLink() ? '[link] ' : ''}${path.join(folder ? path.resolve(folder) : roots[0], e.name)}`,
              )
              .join('\n') || '(empty)',
          );
        },
      ),
    );
  if (allowed.has('file_read') && roots.length)
    tools.push(
      tool(
        'file_read',
        'Read a text file from the open folders (not secrets, not dotfiles). Up to 60 KB.',
        { file: z.string() },
        async ({ file }) => {
          const f = openPath(file, roots, { file: true });
          if (!f) return text('Not allowed.');
          try {
            if (!fs.statSync(f).isFile()) return text('Not a file.');
            return text(fs.readFileSync(f, 'utf8').slice(0, 60000));
          } catch (e) {
            return text(`Cannot read: ${e.message}`);
          }
        },
      ),
    );
  return { server: createSdkMcpServer({ name: 'office', version: '1.0.0', tools }), names: tools.map(t => t.name) };
}
