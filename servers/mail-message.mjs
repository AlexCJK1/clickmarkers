// The raw message for a draft, built by nodemailer (its stream transport sends nothing: it hands the message
// back). Headers are encoded properly and a value cannot add a header of its own: a line break in an address,
// a subject or an In-Reply-To is refused before anything is built.
import nodemailer from 'nodemailer';
import addressparser from 'nodemailer/lib/addressparser/index.js';

const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

/** Throws when a header value holds a line break (a "Hi\r\nBcc: someone" subject). */
export function checkHeaders(fields) {
  for (const [k, v] of Object.entries(fields))
    if (v !== undefined && /[\r\n]/.test(String(v))) throw new Error(`${k} must be one line`);
}

/**
 * Throws unless every recipient is written plainly (jo@larkspur.example or Jo <jo@larkspur.example>). The office
 * checks a send against the addresses it can read in the approved draft; a comment or a quoted part
 * (evil(x)@attacker.example) would let the mail server deliver to an address that check never saw.
 */
export function checkRecipients(to) {
  const raw = String(to || '');
  const flat = list => list.flatMap(a => (a.group ? flat(a.group) : [a]));
  const all = flat(addressparser(raw));
  if (!all.length) throw new Error('to: no address');
  for (const a of all) {
    const at = String(a.address || '');
    const esc = at.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      !/^[^\s@"()<>[\],;:]+@[^\s@"()<>[\],;:]+$/.test(at) ||
      !new RegExp(`(^|[\\s,<])${esc}($|[\\s,>])`, 'i').test(raw)
    )
      throw new Error(`to: write each address plainly, as name@domain (${at || raw})`);
  }
}

/** The draft as RFC 822 text, ready for IMAP APPEND. */
export async function draftMessage({ from, to, subject, body, inReplyTo }) {
  checkHeaders({ to, subject, inReplyTo });
  checkRecipients(to);
  const info = await builder.sendMail({
    from,
    to,
    subject,
    text: body,
    date: new Date(),
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });
  return info.message.toString('utf8');
}
