#!/usr/bin/env node
// Starts one stdio MCP server with a clean environment. Claude Code hands every stdio server it starts its
// own environment, and on the API lane that holds ANTHROPIC_API_KEY, so a third-party server would see the
// key. Every stdio connector is launched through this file instead:
//   node core/clean-env.mjs --keep NAME,NAME -- <command> [args...]
// The server gets only what any program needs to run (the path, the home and temp folders, the locale, a
// proxy) and the variables its registry entry names (--keep). Everything else, keys included, stays out.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** What any program needs to start, find its files and reach the network. Compared upper-case. */
export const BASE_ENV = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'PLAYWRIGHT_BROWSERS_PATH',
  'NPM_CONFIG_CACHE',
  'NPM_CONFIG_PREFIX',
  'NPM_CONFIG_REGISTRY',
]);

/** The environment a server is given: the base names and the kept ones, nothing else. */
export function cleanEnv(env, keep = []) {
  const out = {};
  for (const [k, v] of Object.entries(env))
    if (v !== undefined && (BASE_ENV.has(k.toUpperCase()) || keep.includes(k))) out[k] = v;
  return out;
}

/** Split the launcher's own arguments from the server's command line. */
export function parseArgs(argv) {
  const a = [...argv];
  let keep = [];
  if (a[0] === '--keep') {
    keep = String(a[1] || '')
      .split(',')
      .filter(Boolean);
    a.splice(0, 2);
  }
  if (a[0] === '--') a.shift();
  const [command, ...args] = a;
  return { keep, command, args };
}

// On Windows a .cmd (npx, pipx) only starts through the shell, which joins the arguments with spaces:
// anything with a space or a shell character is quoted.
const quote = a => (/[\s"&|<>^()%!]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);

const self =
  !!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (self) {
  const { keep, command, args } = parseArgs(process.argv.slice(2));
  if (!command) {
    process.stderr.write('clean-env: no command\n');
    process.exit(2);
  }
  const win = process.platform === 'win32';
  const cmd = command === 'node' ? process.execPath : command; // "node" is the Node that runs the office
  const shell = win && cmd !== process.execPath && !/\.(exe|com)$/i.test(cmd);
  const child = spawn(cmd, shell ? args.map(quote) : args, {
    env: cleanEnv(process.env, keep),
    stdio: 'inherit',
    shell,
    windowsHide: true,
  });
  child.on('error', e => {
    process.stderr.write(`clean-env: ${e.message}\n`);
    process.exit(127);
  });
  child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(s, () => {
      try {
        child.kill(s);
      } catch {
        // the child has already gone
      }
    });
}
