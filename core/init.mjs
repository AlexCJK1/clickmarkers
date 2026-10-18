// The owner's own office, kept outside the repo: `clickmarkers init [folder]` copies the example notes and
// company files into one folder (../my-office unless named), makes an empty secrets file and a data folder
// there, and writes office.config.local.json pointing at them. An update (git pull) then never touches
// anything the owner changed, and nothing of theirs is one `git add` away from a pull request.
import fs from 'node:fs';
import path from 'node:path';

const COMPANY = ['company.json', 'routines.json', 'workflows.json', 'connectors.json'];
const slash = p => p.split(path.sep).join('/');

/** Make the folder and the config. Refuses to overwrite either. Returns { target, configFile, secretsFile }. */
export function initOffice({ root, target, configFile = path.join(root, 'office.config.local.json') }) {
  const dir = path.resolve(root, target || '../my-office');
  if (fs.existsSync(configFile))
    throw new Error(`${configFile} already exists: nothing was changed. Move it aside to start again.`);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length)
    throw new Error(`${dir} is not empty: name another folder, for example clickmarkers init ../our-office`);
  const inside = path.relative(root, dir);
  if (!inside.startsWith('..') && !path.isAbsolute(inside))
    throw new Error(`${dir} is inside the Clickmarkers folder: pick one outside it, so updates never touch it`);
  fs.mkdirSync(path.join(dir, 'company'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.cpSync(path.join(root, 'examples', 'brain'), path.join(dir, 'brain'), { recursive: true });
  for (const f of COMPANY) fs.copyFileSync(path.join(root, 'company', f), path.join(dir, 'company', f));
  const secretsFile = path.join(dir, '.secrets.local');
  fs.writeFileSync(
    secretsFile,
    '# One NAME=value per line, for example ANTHROPIC_API_KEY=sk-ant-...\n# Never share or commit this file.\n',
    { mode: 0o600 },
  );
  const at = p => slash(path.join(dir, p));
  const cfg = {
    brain: at('brain'),
    secretsFile: slash(secretsFile),
    company: at('company/company.json'),
    routines: at('company/routines.json'),
    workflows: at('company/workflows.json'),
    connectors: at('company/connectors.json'),
    data: at('data'),
    media: { roots: [at('brain')] },
    files: { roots: [at('brain')] },
    ledger: { ceilingUsd: 10 },
  };
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 1) + '\n');
  return { target: dir, configFile, secretsFile };
}
