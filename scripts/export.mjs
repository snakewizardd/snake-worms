// Inlines the Vite build into one self-contained HTML file: dist/snakes.html
// Works offline from file://, or upload the single file to any static host (itch.io, GitHub Pages, Netlify drop...).
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const distPath = fileURLToPath(new URL('../dist/', import.meta.url));
let html = readFileSync(join(distPath, 'index.html'), 'utf8');

html = html.replace(/<script type="module" crossorigin src="\.?\/?(assets\/[^"]+\.js)"><\/script>/g, (_, file) => {
  const js = readFileSync(join(distPath, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.?\/?(assets\/[^"]+\.css)">/g, (_, file) => `<style>${readFileSync(join(distPath, file), 'utf8')}</style>`);

if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('export: an asset was not inlined');
const out = join(distPath, 'snakes.html');
writeFileSync(out, html);
console.log(`exported ${out} (${(statSync(out).size / 1024).toFixed(1)} KB, single file, plays offline)`);
