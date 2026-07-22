/**
 * Renders the Ara Workbench documentation to PDF.
 *
 * Chrome headless does the printing, so the PDFs look exactly like the HTML in a
 * browser — no second rendering engine to disagree with the first. Mermaid runs
 * as ordinary page JavaScript; --virtual-time-budget is what gives it time to
 * finish laying out before the snapshot is taken.
 *
 *   npm install mermaid            (once, in this folder)
 *   node build.mjs
 *
 * Mermaid is not vendored into the repo — it is 3.5 MB of build tooling, not
 * source. The script copies it into ./vendor on demand.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

if (!CHROME) throw new Error('Neither Chrome nor Edge was found — install one, or edit CHROME above.');

// Vendor mermaid next to the HTML so the page can load it over file://.
const src = resolve(here, 'node_modules/mermaid/dist/mermaid.min.js');
const vendored = resolve(here, 'vendor/mermaid.min.js');
if (existsSync(src)) {
  mkdirSync(resolve(here, 'vendor'), { recursive: true });
  copyFileSync(src, vendored);
} else if (!existsSync(vendored)) {
  throw new Error('Run `npm install mermaid` in docs/src first.');
}

const DOCS = [
  ['playbook.html', 'Ara-Workbench-Playbook.pdf'],
  ['flowcharts.html', 'Ara-Workbench-Flowcharts.pdf'],
];

for (const [html, pdf] of DOCS) {
  const target = resolve(out, pdf);
  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    '--allow-file-access-from-files',
    // Mermaid needs real time to lay out ~20 diagrams; the budget is virtual, so
    // this costs seconds of wall clock, not minutes.
    '--virtual-time-budget=45000',
    `--print-to-pdf=${target}`,
    resolve(here, html),
  ], { stdio: 'inherit' });

  const kb = Math.round(statSync(target).size / 1024);
  console.log(`  ${pdf}  ${kb} KB`);
}
