// =====================================================================
// npm run build:web — the hosted web demo, for any static host.
//
// Builds the app into dist-web/ with the demo engines running inside the
// page (web/demo-shim.ts), so a visitor can cast comics, write sets, render
// and run the Circuit with nothing installed. Everything they make lives in
// their own browser (IndexedDB). Relative URLs, so it works from any folder
// (e.g. https://example.com/Standupify/). Adds an .htaccess for Apache hosts.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-web');

process.env.STANDUPIFY_WEB_DEMO = '1';
const { build } = await import('vite');
await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true } });

// Apache (DreamHost and most shared hosts): right types, long cache for hashed assets, never cache the page.
fs.writeFileSync(path.join(outDir, '.htaccess'), `# Standupify web demo
DirectoryIndex index.html
Options -Indexes

AddType application/manifest+json .webmanifest
AddType application/json .json
AddType text/javascript .js .mjs

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml
</IfModule>

<IfModule mod_headers.c>
  <FilesMatch "\\.(js|css|woff2?|png|jpe?g|gif|webp|svg|mp4)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\\.(html|json)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  Header set X-Content-Type-Options "nosniff"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
`);

const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name)));
walk(outDir);
const bytes = files.reduce((a, f) => a + fs.statSync(f).size, 0);
console.log(`web demo → ${path.relative(root, outDir)}/  (${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log('Upload the contents of that folder to any static host. Open index.html from a web server, not file://.');
