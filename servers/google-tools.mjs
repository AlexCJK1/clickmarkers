// The tools of the office's Google connector, one MCP server per service (drive, docs, sheets,
// calendar) so each desk gets only the services it is given. Reading is free; every tool that writes
// is listed in WRITES and the registry's outbound rules cover exactly those, so before the owner's OK
// a desk can read but not change anything. There is no delete or trash tool at all. Sharing a file and
// inviting guests reach other people: they are separate tools (drive_share, calendar_invite).
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SERVICES, GoogleError, toInstant, clip } from '../io/google-api.mjs';
import { localDate } from '../core/clock.mjs';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DOCS = 'https://docs.googleapis.com/v1';
const SHEETS = 'https://sheets.googleapis.com/v4';
const CAL = 'https://www.googleapis.com/calendar/v3';
export const MIME = {
  doc: 'application/vnd.google-apps.document', sheet: 'application/vnd.google-apps.spreadsheet', slides: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder', pdf: 'application/pdf',
};
const KIND = { [MIME.doc]: 'Google Doc', [MIME.sheet]: 'Google Sheet', [MIME.slides]: 'Google Slides', [MIME.folder]: 'folder', [MIME.pdf]: 'PDF' };
const kind = m => KIND[m] || m || 'file';
const enc = encodeURIComponent;
const MAX_READ = 80000;   // characters a read may ask for
const MAX_OUT = 60000;    // no answer longer than this reaches the desk (Claude Code caps MCP output in tokens)

/** Tools that read, and tools that write (the registry's outbound rules must cover exactly WRITES). */
export const READS = { drive: ['drive_search', 'drive_read'], docs: ['docs_read'], sheets: ['sheets_info', 'sheets_read'], calendar: ['calendar_events'] };
export const WRITES = {
  drive: ['drive_create_file', 'drive_create_folder', 'drive_update_file', 'drive_move', 'drive_share'],
  docs: ['docs_create', 'docs_append', 'docs_replace_text'],
  sheets: ['sheets_create', 'sheets_add_tab', 'sheets_write', 'sheets_append'],
  calendar: ['calendar_add', 'calendar_update', 'calendar_invite'],
};

// ---- Drive ------------------------------------------------------------------------------------------
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
/** A Drive search expression from plain parts (text is matched in names and contents). */
export function driveQuery({ text = '', folderId = '', type = 'any' } = {}) {
  const parts = ['trashed = false'];
  if (text) parts.push(`(name contains '${q(text)}' or fullText contains '${q(text)}')`);
  if (folderId) parts.push(`'${q(folderId)}' in parents`);
  if (type === 'file') parts.push(`mimeType != '${MIME.folder}'`);
  else if (type && type !== 'any') parts.push(`mimeType = '${MIME[type]}'`);
  return parts.join(' and ');
}
const fileLine = f => `${f.name} · ${kind(f.mimeType)}${f.modifiedTime ? ' · ' + String(f.modifiedTime).slice(0, 16).replace('T', ' ') : ''} · id ${f.id}${f.webViewLink ? ' · ' + f.webViewLink : ''}`;
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,webViewLink,size,parents';

async function search(g, { text = '', folderId = '', type = 'any', query = '', max = 25 }) {
  const expr = query ? `(${query}) and trashed = false` : driveQuery({ text, folderId, type });
  const full = !!text || /fullText/.test(query);
  const j = await g.call('GET', `${DRIVE}/files`, { service: 'drive', query: { q: expr, pageSize: Math.max(1, Math.min(100, max | 0 || 25)), fields: `files(${FILE_FIELDS})`, ...(full ? {} : { orderBy: 'folder,modifiedTime desc' }) } });
  const files = j.files || [];
  return files.length ? files.map(fileLine).join('\n') : 'Nothing matches.';
}

/** A multipart upload (metadata and content in one request). */
async function multipart(g, method, url, meta, content, type) {
  let b; do { b = 'co' + crypto.randomBytes(12).toString('hex'); } while (String(content).includes(b));
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}; charset=UTF-8\r\n\r\n${content}\r\n--${b}--`;
  return g.call(method, url, { service: 'drive', query: { uploadType: 'multipart', fields: 'id,name,mimeType,webViewLink' }, body, contentType: `multipart/related; boundary=${b}` });
}

/** A Google Doc from markdown (Drive converts it: headings, lists, bold); plain text when markdown is refused. */
async function importDoc(g, { name, content, folderId = '' }) {
  const meta = { name, mimeType: MIME.doc, ...(folderId ? { parents: [folderId] } : {}) };
  try { return await multipart(g, 'POST', `${UPLOAD}/files`, meta, content, 'text/markdown'); }
  catch (e) { if (e.status === 400) return multipart(g, 'POST', `${UPLOAD}/files`, meta, content, 'text/plain'); throw e; }
}

async function moveTo(g, fileId, folderId) {
  const f = await g.call('GET', `${DRIVE}/files/${enc(fileId)}`, { service: 'drive', query: { fields: 'id,parents' } });
  return g.call('PATCH', `${DRIVE}/files/${enc(fileId)}`, { service: 'drive', json: {}, query: { addParents: folderId, removeParents: (f.parents || []).filter(p => p !== folderId).join(','), fields: 'id,name,mimeType,webViewLink,parents' } });
}

const TEXTLIKE = /^text\/|^application\/(json|xml|x-yaml|yaml|javascript|x-ndjson|csv)/;

async function readFile(g, { fileId, maxChars = 50000 }) {
  const n = Math.max(1000, Math.min(MAX_READ, maxChars | 0 || 50000));
  const meta = await g.call('GET', `${DRIVE}/files/${enc(fileId)}`, { service: 'drive', query: { fields: FILE_FIELDS } });
  const head = `${meta.name} · ${kind(meta.mimeType)} · ${meta.webViewLink || ''}\n\n`;
  const exp = mime => g.call('GET', `${DRIVE}/files/${enc(fileId)}/export`, { service: 'drive', query: { mimeType: mime }, as: 'text' });
  let body;
  if (meta.mimeType === MIME.folder) return head + await search(g, { folderId: meta.id, max: 100 });
  if (meta.mimeType === MIME.doc) { try { body = await exp('text/markdown'); } catch (e) { if (e.status !== 400) throw e; body = await exp('text/plain'); } }
  else if (meta.mimeType === MIME.sheet) body = '(the first tab as CSV; sheets_read reads any tab or range)\n' + await exp('text/csv');
  else if (meta.mimeType === MIME.slides) body = await exp('text/plain');
  else if (TEXTLIKE.test(meta.mimeType || '')) {
    if (+meta.size > 5e6) throw new GoogleError(`${meta.name} is ${Math.round(+meta.size / 1e6)} MB; this reads text files up to 5 MB.`, { kind: 'input' });
    body = await g.call('GET', `${DRIVE}/files/${enc(fileId)}`, { service: 'drive', query: { alt: 'media' }, as: 'text' });
  } else return `${head}This connector reads Google Docs, Sheets, Slides and text files; ${meta.name} is ${kind(meta.mimeType)}. Open it with the link.`;
  const s = String(body ?? '');
  return head + (s.length > n ? s.slice(0, n) + `\n… (cut at ${n} of ${s.length} characters)` : s);
}

// ---- Docs -------------------------------------------------------------------------------------------
const HEAD = { TITLE: '# ', SUBTITLE: '## ', HEADING_1: '# ', HEADING_2: '## ', HEADING_3: '### ', HEADING_4: '#### ', HEADING_5: '##### ', HEADING_6: '###### ' };
function blocks(content = []) {
  const lines = [];
  for (const el of content) {
    if (el.paragraph) {
      const p = el.paragraph;
      const t = (p.elements || []).map(e => e.textRun?.content ?? e.person?.personProperties?.email ?? e.richLink?.richLinkProperties?.title ?? '').join('').replace(/\u000b/g, '\n').replace(/\n$/, '');
      const pre = HEAD[p.paragraphStyle?.namedStyleType] || (p.bullet ? '  '.repeat(p.bullet.nestingLevel || 0) + '- ' : '');
      lines.push(t ? pre + t : '');
    } else if (el.table) {
      for (const row of el.table.tableRows || []) lines.push('| ' + (row.tableCells || []).map(c => blocks(c.content).replace(/\s*\n\s*/g, ' ').trim()).join(' | ') + ' |');
      lines.push('');
    }
  }
  return lines.join('\n');
}
/** A document's text with headings and bullets marked as markdown; every tab, in order. */
export function docText(doc = {}) {
  const tabs = []; const walk = ts => { for (const t of ts || []) { tabs.push(t); walk(t.childTabs); } }; walk(doc.tabs);
  const parts = tabs.length ? tabs.map(t => ({ title: t.tabProperties?.title || '', body: t.documentTab?.body })) : [{ title: '', body: doc.body }];
  return parts.map((p, i) => (parts.length > 1 ? `=== Tab: ${p.title || i + 1} ===\n` : '') + blocks(p.body?.content)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- Sheets -----------------------------------------------------------------------------------------
const csvCell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = rows => rows.map(r => (r || []).map(csvCell).join(',')).join('\n');
const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const Rows = z.array(z.array(Cell)).min(1).max(10000);

// ---- Calendar ---------------------------------------------------------------------------------------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDay = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
const localDay = (iso, tz) => { const d = localDate(Date.parse(iso), tz); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; };
function fmtWhen(ev, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  if (ev.start?.date) { const last = ev.end?.date ? addDay(ev.end.date, -1) : ev.start.date; return `${ev.start.date}${last > ev.start.date ? ' to ' + last : ''} (all day)`; }
  const s = ev.start?.dateTime ? new Date(ev.start.dateTime) : null, e = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
  return s ? `${f.format(s)}${e ? '–' + t.format(e) : ''}` : '?';
}
/** Start and end for an event. A date makes an all-day event: end is the last day (inclusive, default
 *  the start day; Google's own end is the day after, worked out here). A time defaults to one hour. */
export function eventTimes({ start, end, allDay }, tz = 'Europe/London') {
  if (allDay === false && DATE.test(String(start || ''))) throw new GoogleError('A timed event needs a start time, like 2026-10-13T09:00.', { kind: 'input' });
  if (allDay === true || (allDay !== false && DATE.test(String(start || '')))) {
    const s = String(start || '').slice(0, 10); if (!DATE.test(s)) throw new GoogleError('An all-day event needs a date like 2026-10-13.', { kind: 'input' });
    toInstant(s, tz); // checks the date is real
    const last = end ? String(end).slice(0, 10) : s;
    if (!DATE.test(last)) throw new GoogleError('The end of an all-day event is a date like 2026-10-14 (the last day).', { kind: 'input' });
    toInstant(last, tz);
    if (last < s) throw new GoogleError('The last day cannot come before the first.', { kind: 'input' });
    return { start: { date: s }, end: { date: addDay(last, 1) } };
  }
  const s = toInstant(start, tz); const e = end ? toInstant(end, tz) : new Date(Date.parse(s) + 3600000).toISOString();
  if (Date.parse(e) <= Date.parse(s)) throw new GoogleError('The end must come after the start.', { kind: 'input' });
  return { start: { dateTime: s, timeZone: tz }, end: { dateTime: e, timeZone: tz } };
}
const Email = z.string().regex(/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/, 'an email address');

/**
 * The MCP server for the given services. google: an io/google-api.mjs Google (or a stand-in in tests).
 */
export function buildServer({ google: g, services = Object.keys(SERVICES), tz = 'Europe/London' } = {}) {
  const on = new Set(services);
  const server = new McpServer({ name: 'google', version: '1.0.0' }, { instructions: `The office's Google account (${services.map(s => SERVICES[s].label).join(', ')}). Reading is free; anything that creates, changes, shares or invites waits for the owner's OK. Nothing can be deleted. Times without a zone are office time (${tz}).` });
  const add = (svc, name, description, shape, fn) => {
    if (!on.has(svc)) return;
    const writes = WRITES[svc].includes(name);
    server.tool(name, description, shape, { readOnlyHint: !writes, destructiveHint: false, openWorldHint: name === 'drive_share' || name === 'calendar_invite' }, async args => {
      try { let out = String(await fn(args || {})); if (out.length > MAX_OUT) out = out.slice(0, MAX_OUT) + '\n… (cut here: the answer was too long; ask for less, e.g. a smaller range)'; return { content: [{ type: 'text', text: out }] }; }
      catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof GoogleError ? e.message : `Something went wrong: ${clip(e?.message || e, 300)}` }] }; }
    });
  };
  const notDots = v => !/^\s*\.+\s*$/.test(v); // "." or ".." would walk the URL up a level
  const id = z.string().min(1).max(200).refine(notDots, 'not an id');
  const range = z.string().min(1).max(200).refine(notDots, 'not a range');

  // Drive
  add('drive', 'drive_search', 'Find files in the office Google Drive. text matches names and contents; folderId alone lists that folder ("root" is the top of My Drive); type narrows to doc, sheet, slides, folder, pdf or file; query takes raw Drive search syntax instead. With nothing given: the most recently changed files.',
    { text: z.string().max(200).optional(), folderId: id.optional(), type: z.enum(['any', 'doc', 'sheet', 'slides', 'folder', 'pdf', 'file']).optional(), query: z.string().max(500).optional(), max: z.number().int().min(1).max(100).optional() },
    a => search(g, a));
  add('drive', 'drive_read', 'Read a file by id: Google Docs as markdown, Sheets as CSV (first tab), Slides as text, plain text files as they are; a folder is listed. Up to maxChars characters (default 50,000).',
    { fileId: id, maxChars: z.number().int().min(1000).max(MAX_READ).optional() }, a => readFile(g, a));
  add('drive', 'drive_create_file', 'Create a file. format doc (default) makes a Google Doc from markdown; text, markdown and csv store the file exactly as given. For a spreadsheet use sheets_create, then sheets_write (values stay exactly as given). Optional folderId.',
    { name: z.string().min(1).max(300), content: z.string().max(5_000_000), format: z.enum(['doc', 'text', 'markdown', 'csv']).optional(), folderId: id.optional() },
    async ({ name, content, format = 'doc', folderId = '' }) => {
      let f;
      if (format === 'doc') f = await importDoc(g, { name, content, folderId });
      else f = await multipart(g, 'POST', `${UPLOAD}/files`, { name, ...(folderId ? { parents: [folderId] } : {}) }, content, { text: 'text/plain', markdown: 'text/markdown', csv: 'text/csv' }[format]);
      return `Created ${fileLine(f)}`;
    });
  add('drive', 'drive_create_folder', 'Create a folder (optional parentId; default the top of My Drive).', { name: z.string().min(1).max(300), parentId: id.optional() },
    async ({ name, parentId = '' }) => `Created ${fileLine(await g.call('POST', `${DRIVE}/files`, { service: 'drive', json: { name, mimeType: MIME.folder, ...(parentId ? { parents: [parentId] } : {}) }, query: { fields: 'id,name,mimeType,webViewLink' } }))}`);
  add('drive', 'drive_update_file', 'Replace the whole content of a plain text, markdown or CSV file. Google Docs and Sheets change through the docs_ and sheets_ tools instead.', { fileId: id, content: z.string().max(5_000_000) },
    async ({ fileId, content }) => {
      const meta = await g.call('GET', `${DRIVE}/files/${enc(fileId)}`, { service: 'drive', query: { fields: 'id,name,mimeType' } });
      if (String(meta.mimeType).startsWith('application/vnd.google-apps.')) throw new GoogleError(`${meta.name} is a ${kind(meta.mimeType)}: change it with the docs_ or sheets_ tools.`, { kind: 'input' });
      if (!TEXTLIKE.test(meta.mimeType || '')) throw new GoogleError(`${meta.name} is ${kind(meta.mimeType)}; only text files can be replaced here.`, { kind: 'input' });
      const f = await g.call('PATCH', `${UPLOAD}/files/${enc(fileId)}`, { service: 'drive', query: { uploadType: 'media', fields: 'id,name,mimeType,webViewLink' }, body: content, contentType: `${meta.mimeType}; charset=UTF-8` });
      return `Replaced the content of ${fileLine(f)}`;
    });
  add('drive', 'drive_move', 'Move a file or folder into another folder.', { fileId: id, folderId: id }, async ({ fileId, folderId }) => `Moved: ${fileLine(await moveTo(g, fileId, folderId))}`);
  add('drive', 'drive_share', 'Share a file or folder with one person by email (reader, commenter or writer). Google emails them unless notify is false. Reaches someone outside the office.',
    { fileId: id, email: Email, role: z.enum(['reader', 'commenter', 'writer']).optional(), notify: z.boolean().optional(), message: z.string().max(1000).optional() },
    async ({ fileId, email, role = 'reader', notify = true, message = '' }) => {
      await g.call('POST', `${DRIVE}/files/${enc(fileId)}/permissions`, { service: 'drive', json: { type: 'user', role, emailAddress: email }, query: { sendNotificationEmail: notify ? 'true' : 'false', ...(notify && message ? { emailMessage: message } : {}), fields: 'id,role' } });
      return `Shared with ${email} as ${role}${notify ? ' (Google emailed them)' : ''}.`;
    });

  // Docs
  add('docs', 'docs_read', 'Read a Google Doc by id: the text of every tab, headings and bullets marked as markdown, tables as rows.',
    { documentId: id, maxChars: z.number().int().min(1000).max(MAX_READ).optional() },
    async ({ documentId, maxChars = 50000 }) => {
      const d = await g.call('GET', `${DOCS}/documents/${enc(documentId)}`, { service: 'docs', query: { includeTabsContent: 'true' } });
      const s = docText(d); const n = Math.min(MAX_READ, maxChars);
      return `${d.title || 'Untitled'} · https://docs.google.com/document/d/${d.documentId || documentId}/edit\n\n${s.length > n ? s.slice(0, n) + `\n… (cut at ${n} of ${s.length} characters)` : s}`;
    });
  add('docs', 'docs_create', 'Create a Google Doc with a title and optional markdown text (headings, lists and bold come through). Optional folderId.',
    { title: z.string().min(1).max(300), text: z.string().max(1_000_000).optional(), folderId: id.optional() },
    async ({ title, text = '', folderId = '' }) => {
      try { return `Created ${fileLine(await importDoc(g, { name: title, content: text, folderId }))}`; }
      catch (e) {
        if (folderId || !['scope', 'disabled'].includes(e.kind)) throw e;
        // without Drive: the Docs API alone (plain text)
        const d = await g.call('POST', `${DOCS}/documents`, { service: 'docs', json: { title } });
        if (text) await g.call('POST', `${DOCS}/documents/${enc(d.documentId)}:batchUpdate`, { service: 'docs', json: { requests: [{ insertText: { location: { index: 1 }, text } }] } });
        return `Created ${title} · Google Doc · id ${d.documentId} · https://docs.google.com/document/d/${d.documentId}/edit`;
      }
    });
  add('docs', 'docs_append', 'Add text to the end of a Google Doc (as a new paragraph, in its first tab).', { documentId: id, text: z.string().min(1).max(1_000_000) },
    async ({ documentId, text }) => { await g.call('POST', `${DOCS}/documents/${enc(documentId)}:batchUpdate`, { service: 'docs', json: { requests: [{ insertText: { endOfSegmentLocation: {}, text: '\n' + text } }] } }); return `Added ${text.length} characters to the end.`; });
  add('docs', 'docs_replace_text', 'Replace every occurrence of some text in a Google Doc.', { documentId: id, find: z.string().min(1).max(5000), replace: z.string().max(100000), matchCase: z.boolean().optional() },
    async ({ documentId, find, replace, matchCase = true }) => {
      const r = await g.call('POST', `${DOCS}/documents/${enc(documentId)}:batchUpdate`, { service: 'docs', json: { requests: [{ replaceAllText: { containsText: { text: find, matchCase }, replaceText: replace } }] } });
      const n = r.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
      return n ? `Replaced ${n} occurrence${n === 1 ? '' : 's'}.` : 'Nothing matched; the document is unchanged.';
    });

  // Sheets
  add('sheets', 'sheets_info', 'A spreadsheet\'s title, link and tabs (with their sizes).', { spreadsheetId: id },
    async ({ spreadsheetId }) => {
      const s = await g.call('GET', `${SHEETS}/spreadsheets/${enc(spreadsheetId)}`, { service: 'sheets', query: { fields: 'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))' } });
      return `${s.properties?.title || ''} · ${s.spreadsheetUrl || ''}\n` + (s.sheets || []).map(x => `tab "${x.properties?.title}" · ${x.properties?.gridProperties?.rowCount || 0} rows × ${x.properties?.gridProperties?.columnCount || 0} columns`).join('\n');
    });
  add('sheets', 'sheets_read', 'Read cells as CSV. range in A1 form, e.g. "Leads!A1:F200" or just a tab name. Up to maxRows rows (default 500).',
    { spreadsheetId: id, range, maxRows: z.number().int().min(1).max(10000).optional() },
    async ({ spreadsheetId, range, maxRows = 500 }) => {
      const r = await g.call('GET', `${SHEETS}/spreadsheets/${enc(spreadsheetId)}/values/${enc(range)}`, { service: 'sheets', query: { majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' } });
      const rows = r.values || []; if (!rows.length) return `${r.range || range}: empty.`;
      return `${r.range || range} · ${rows.length} rows${rows.length > maxRows ? ` (first ${maxRows} shown)` : ''}\n${toCsv(rows.slice(0, maxRows))}`;
    });
  const inputOption = parse => (parse ? 'USER_ENTERED' : 'RAW');
  const PARSE = 'parse true reads each value as if typed (formulas, dates, percentages); leave it off for text that came from outside (names, messages), which is then stored exactly as given and never run as a formula.';
  add('sheets', 'sheets_write', `Write rows of values starting at range (A1 form), overwriting what is there. ${PARSE}`,
    { spreadsheetId: id, range, values: Rows, parse: z.boolean().optional() },
    async ({ spreadsheetId, range, values, parse = false }) => {
      const r = await g.call('PUT', `${SHEETS}/spreadsheets/${enc(spreadsheetId)}/values/${enc(range)}`, { service: 'sheets', query: { valueInputOption: inputOption(parse) }, json: { range, majorDimension: 'ROWS', values } });
      return `Wrote ${r.updatedCells || 0} cells in ${r.updatedRange || range}.`;
    });
  add('sheets', 'sheets_append', `Add rows under the last row of the table at range (e.g. "Leads!A1"). ${PARSE}`,
    { spreadsheetId: id, range, values: Rows, parse: z.boolean().optional() },
    async ({ spreadsheetId, range, values, parse = false }) => {
      const r = await g.call('POST', `${SHEETS}/spreadsheets/${enc(spreadsheetId)}/values/${enc(range)}:append`, { service: 'sheets', query: { valueInputOption: inputOption(parse), insertDataOption: 'INSERT_ROWS' }, json: { majorDimension: 'ROWS', values } });
      return `Added ${values.length} row${values.length === 1 ? '' : 's'} at ${r.updates?.updatedRange || range}.`;
    });
  add('sheets', 'sheets_create', 'Create a spreadsheet, optionally with named tabs and in a folder.', { title: z.string().min(1).max(300), tabs: z.array(z.string().min(1).max(100)).max(50).optional(), folderId: id.optional() },
    async ({ title, tabs = [], folderId = '' }) => {
      const s = await g.call('POST', `${SHEETS}/spreadsheets`, { service: 'sheets', json: { properties: { title }, ...(tabs.length ? { sheets: tabs.map(t => ({ properties: { title: t } })) } : {}) } });
      let where = '';
      if (folderId) { try { await moveTo(g, s.spreadsheetId, folderId); where = ' in the folder'; } catch (e) { where = ` (made, but not moved into the folder: ${e.message})`; } }
      return `Created ${title}${where} · Google Sheet · id ${s.spreadsheetId} · ${s.spreadsheetUrl || ''}`;
    });
  add('sheets', 'sheets_add_tab', 'Add a tab to a spreadsheet.', { spreadsheetId: id, title: z.string().min(1).max(100) },
    async ({ spreadsheetId, title }) => { await g.call('POST', `${SHEETS}/spreadsheets/${enc(spreadsheetId)}:batchUpdate`, { service: 'sheets', json: { requests: [{ addSheet: { properties: { title } } }] } }); return `Added the tab "${title}".`; });

  // Calendar
  const cal = z.string().min(1).max(200).refine(notDots, 'not a calendar id').optional();
  const fields = { summary: z.string().min(1).max(500), start: z.string().min(10).max(40), end: z.string().min(10).max(40).optional(), allDay: z.boolean().optional(), description: z.string().max(8000).optional(), location: z.string().max(500).optional(), calendarId: cal };
  const insert = async ({ summary, start, end, allDay, description, location, calendarId = 'primary' }, attendees) => {
    const ev = { summary, ...eventTimes({ start, end, allDay }, tz), ...(description ? { description } : {}), ...(location ? { location } : {}), ...(attendees ? { attendees: attendees.map(email => ({ email })) } : {}) };
    return g.call('POST', `${CAL}/calendars/${enc(calendarId)}/events`, { service: 'calendar', json: ev, query: { sendUpdates: attendees ? 'all' : 'none' } });
  };
  add('calendar', 'calendar_events', `Events between from and to (default: the next 14 days), optionally matching text. Times without a zone are office time (${tz}).`,
    { from: z.string().min(10).max(40).optional(), to: z.string().min(10).max(40).optional(), text: z.string().max(200).optional(), max: z.number().int().min(1).max(250).optional(), calendarId: cal },
    async ({ from, to, text = '', max = 50, calendarId = 'primary' }) => {
      const a = from ? toInstant(from, tz) : new Date().toISOString(); const b = to ? toInstant(to, tz) : new Date(Date.parse(a) + 14 * 86400000).toISOString();
      if (Date.parse(b) <= Date.parse(a)) throw new GoogleError('"to" must come after "from".', { kind: 'input' });
      const j = await g.call('GET', `${CAL}/calendars/${enc(calendarId)}/events`, { service: 'calendar', query: { timeMin: a, timeMax: b, q: text, singleEvents: 'true', orderBy: 'startTime', maxResults: max } });
      const items = j.items || []; if (!items.length) return 'No events in that window.';
      return items.map(ev => { const guests = (ev.attendees || []).filter(x => !x.self && !x.resource).length; return `${fmtWhen(ev, tz)} · ${ev.summary || '(no title)'}${ev.location ? ' · ' + ev.location : ''}${guests ? ` · ${guests} guest${guests === 1 ? '' : 's'}` : ''} · id ${ev.id}`; }).join('\n');
    });
  add('calendar', 'calendar_add', `Put an event in the office calendar, with no guests (nobody is told). start and end like 2026-10-13T09:00 (office time), end defaulting to an hour later; or dates for an all-day event, end being the last day (default: the same day).`,
    fields, async a => { const ev = await insert(a); return `Added: ${fmtWhen(ev, tz)} · ${ev.summary} · id ${ev.id}`; });
  add('calendar', 'calendar_invite', 'Create an event and invite guests by email: Google sends each guest an invitation. Reaches people outside the office.',
    { ...fields, attendees: z.array(Email).min(1).max(50) }, async ({ attendees, ...a }) => { const ev = await insert(a, attendees); return `Invited ${attendees.length}: ${fmtWhen(ev, tz)} · ${ev.summary} · id ${ev.id}`; });
  add('calendar', 'calendar_update', 'Change an event that has no guests (title, times, description, place). An event with guests is refused: changing it would notify them.',
    { eventId: id, summary: z.string().min(1).max(500).optional(), start: z.string().min(10).max(40).optional(), end: z.string().min(10).max(40).optional(), allDay: z.boolean().optional(), description: z.string().max(8000).optional(), location: z.string().max(500).optional(), calendarId: cal },
    async ({ eventId, summary, start, end, allDay, description, location, calendarId = 'primary' }) => {
      const ev = await g.call('GET', `${CAL}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, { service: 'calendar' });
      const guests = (ev.attendees || []).filter(x => !x.self && !x.resource);
      if (guests.length) throw new GoogleError(`"${ev.summary || 'This event'}" has ${guests.length} guest${guests.length === 1 ? '' : 's'}; changing it would notify them. Ask the owner to change it.`, { kind: 'guests' });
      const patch = { ...(summary ? { summary } : {}), ...(description !== undefined ? { description } : {}), ...(location !== undefined ? { location } : {}) };
      const wasAllDay = !!ev.start?.date;
      const toAllDay = allDay ?? (start ? DATE.test(start) : wasAllDay);
      if (start || end || toAllDay !== wasAllDay) {
        let s = start, e = end;
        if (toAllDay) {
          if (!s) s = wasAllDay ? ev.start.date : localDay(ev.start?.dateTime, tz);
          if (!e && start && wasAllDay && ev.end?.date) e = addDay(s, dayDiff(ev.start.date, ev.end.date) - 1); // keep the number of days
        } else {
          if (!s) { if (wasAllDay) throw new GoogleError('Give a start time to turn an all-day event into a timed one.', { kind: 'input' }); s = ev.start?.dateTime; }
          if (!e && start && !wasAllDay && ev.start?.dateTime && ev.end?.dateTime) e = new Date(Date.parse(toInstant(start, tz)) + (Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime))).toISOString(); // keep the length
        }
        const t = eventTimes({ start: s, end: e, allDay: toAllDay }, tz);
        // PATCH merges inside start and end, so the other kind is cleared explicitly (the kind is the one eventTimes made)
        const day = 'date' in t.start;
        patch.start = day ? { date: t.start.date, dateTime: null, timeZone: null } : { ...t.start, date: null };
        patch.end = day ? { date: t.end.date, dateTime: null, timeZone: null } : { ...t.end, date: null };
      }
      if (!Object.keys(patch).length) return 'Nothing to change.';
      const r = await g.call('PATCH', `${CAL}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, { service: 'calendar', json: patch, query: { sendUpdates: 'none' } });
      return `Changed: ${fmtWhen(r, tz)} · ${r.summary || ''} · id ${r.id}`;
    });

  return server;
}
