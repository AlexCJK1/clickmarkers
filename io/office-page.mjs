// The one-off page a browser lands on after a sign-in (Google, Meta), in the office's own colours.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The one-off page the browser lands on, in the office's own colours, with a way back to the office. */
export function page(res, title, body, { office = '', ok = false } = {}) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  const back = office ? `<p style="margin-top:28px"><a href="${esc(office)}" style="color:#0B0E14;background:#39D0C8;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open Nightdesk</a></p>` : '';
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="margin:0;min-height:100vh;background:#0B0E14;color:#E6EAF2;font:16px/1.55 Inter,'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box"><main style="max-width:560px;background:#121722;border:1px solid ${ok ? '#227f7a' : '#3a2a2a'};border-radius:14px;padding:32px;box-shadow:0 8px 32px rgb(0 0 0 / .45)"><div style="font:600 12px/1 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:${ok ? '#39D0C8' : '#FF5A4A'}">Nightdesk</div><h1 style="font-size:22px;margin:12px 0 10px">${esc(title)}</h1><p style="color:#AEB6C6;margin:0">${esc(body)}</p>${back}</main></body>`);
}
