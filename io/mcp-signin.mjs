// Signing the office in to a remote connector that uses OAuth. The office reuses Claude Code's sign-in, and
// `claude mcp login` needs a real terminal, so this opens one on the computer the office runs on: a small
// script that adds the server to Claude Code when it is missing and runs the login, which opens the browser.
// Only a registry connector with auth "oauth", a plain key and a plain https address gets this far, and
// nothing from the request reaches the script but that key, already matched against the registry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const KEY = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PLAIN_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/;

/** The sign-in script for this platform ({ file, text }), or { error } saying why there is none. */
export function signInScript(c, { platform = process.platform } = {}) {
  if (!c) return { error: 'no such connector' };
  if (c.auth !== 'oauth') return { error: 'this connector does not sign in through a browser' };
  if (!KEY.test(String(c.key || ''))) return { error: 'the connector key is not a plain name' };
  if (!PLAIN_URL.test(String(c.url || ''))) return { error: 'the connector has no plain https address' };
  const { key, url } = c;
  const t = c.type === 'sse' ? 'sse' : 'http';
  if (platform === 'win32')
    return {
      file: `clickmarkers-signin-${key}.cmd`,
      text: [
        '@echo off',
        `title Clickmarkers sign-in: ${key}`,
        `echo Signing the office in to ${key}. A browser page opens: log in and press Allow.`,
        // signed in already: say so and stop, because a second login starts over and drops the first
        `call claude mcp get ${key} 2>nul | findstr /C:"Connected" >nul && (echo Already signed in. & goto done)`,
        `call claude mcp get ${key} >nul 2>&1 || call claude mcp add --transport ${t} ${key} ${url} -s user`,
        `call claude mcp login ${key}`,
        ':done',
        'echo.',
        'echo Done. In the office, press Check now. You can close this window.',
        'pause',
        '',
      ].join('\r\n'),
    };
  return {
    file: `clickmarkers-signin-${key}.${platform === 'darwin' ? 'command' : 'sh'}`,
    text: [
      '#!/bin/sh',
      `echo "Signing the office in to ${key}. A browser page opens: log in and press Allow."`,
      `if claude mcp get ${key} 2>/dev/null | grep -q Connected; then echo "Already signed in."; else`,
      `  claude mcp get ${key} >/dev/null 2>&1 || claude mcp add --transport ${t} ${key} '${url}' -s user`,
      `  claude mcp login ${key}`,
      'fi',
      'echo "Done. In the office, press Check now. You can close this window."',
      'read -r _',
      '',
    ].join('\n'),
  };
}

/** Write the script to the temp folder and open it in a terminal window on this computer. */
export function openSignIn(c, { tmp = os.tmpdir(), platform = process.platform, run = spawn } = {}) {
  const s = signInScript(c, { platform });
  if (s.error) return s;
  const file = path.join(tmp, s.file);
  fs.writeFileSync(file, s.text, { mode: 0o700 });
  const opts = { detached: true, stdio: 'ignore' };
  // through the desktop shell, so the window belongs to the person at the computer, not to the office
  if (platform === 'win32') run('explorer.exe', [file], opts).unref();
  else if (platform === 'darwin') run('open', ['-a', 'Terminal', file], opts).unref();
  else return { error: `open a terminal on this computer and run: sh ${file}` };
  return { ok: true, opened: c.key };
}
