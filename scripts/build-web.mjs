// =====================================================================
// npm run build:web — the hosted web demo, for any static host.
//
// Builds the app into dist-web/ with the demo engines running inside the
// page (web/demo-shim.ts), so a visitor can cast comics, write sets, render
// and run the Circuit with nothing installed. Everything they make lives in
// their own browser (IndexedDB). Relative URLs, so it works from any folder
// (e.g. https://example.com/Standupify/). Adds an .htaccess for Apache hosts.
//
// If `npm run desktop:build` has produced Windows installers, they are
// copied to dist-web/downloads/ with a downloads.json, and the demo's
// Download button offers them (components/DownloadApp.tsx).
//
// The demo engines show real footage: the Station's own headshots, stills
// and clips (from landing/station.js, `npm run landing`) are packed into
// dist-web/demo-media/ with a manifest, and web/demo-engines.ts serves the
// right comic's frames for each render.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-web');

process.env.STANDUPIFY_WEB_DEMO = '1';
const { build } = await import('vite');
await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true } });

// Real footage for the demo engines, per comic.
const CLIPS_PER_COMIC = 10, STILLS_PER_COMIC = 8;
const station = (() => {
  try { const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, 'landing', 'station.js'), 'utf8'), ctx); return ctx.window.STATION; }
  catch { return null; }
})();
if (station?.comics?.length) {
  const mediaOut = path.join(outDir, 'demo-media');
  fs.mkdirSync(mediaOut, { recursive: true });
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  let bytes = 0;
  const put = (rel) => {
    const src = path.join(root, 'landing', rel);
    if (!rel || !fs.existsSync(src)) return null;
    const base = path.basename(rel);
    // Stills are 1 MB PNGs; a 1024px JPEG looks the same in the player at a seventh of the size.
    if (ffmpeg && base.endsWith('.png')) {
      const jpg = base.replace(/\.png$/, '.jpg'), dst = path.join(mediaOut, jpg);
      if (!fs.existsSync(dst)) spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='min(1024,iw)':-2", '-q:v', '3', dst]);
      if (fs.existsSync(dst)) { bytes += fs.statSync(dst).size; return `demo-media/${jpg}`; }
    }
    const dst = path.join(mediaOut, base);
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    bytes += fs.statSync(dst).size;
    return `demo-media/${base}`;
  };
  const comics = station.comics.filter(c => c.headshot && c.look).map(c => {
    const stills = station.stills.filter(s => s.comic === c.name && s.src !== c.headshot).slice(0, STILLS_PER_COMIC).map(s => put(s.src)).filter(Boolean);
    const clips = station.clips.filter(s => s.comic === c.name).slice(0, CLIPS_PER_COMIC).map(s => put(s.src)).filter(Boolean);
    return { name: c.name, tagline: c.tagline, look: c.look, headshot: put(c.headshot), stills, clips };
  }).filter(c => c.headshot);
  fs.writeFileSync(path.join(mediaOut, 'manifest.json'), JSON.stringify({ builtAt: station.builtAt, comics }));
  console.log(`demo media → ${comics.length} comics, ${comics.reduce((a, c) => a + c.stills.length + 1, 0)} stills, ${comics.reduce((a, c) => a + c.clips.length, 0)} clips (${(bytes / 1048576).toFixed(0)} MB)`);
} else {
  console.log('No landing/station.js (npm run landing): the demo engines will draw procedural frames.');
}

// The newest desktop installers, if any were built.
const bundle = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
const newest = (dir, re) => {
  try {
    return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch { return null; }
};
const installers = [
  { kind: 'exe', src: newest(path.join(bundle, 'nsis'), /^Standupify_.*-setup\.exe$/) },
  { kind: 'msi', src: newest(path.join(bundle, 'msi'), /^Standupify_.*\.msi$/) }
].filter(i => i.src);
if (installers.length) {
  const dl = path.join(outDir, 'downloads');
  fs.mkdirSync(dl, { recursive: true });
  const files = installers.map(({ kind, src }) => {
    fs.copyFileSync(src, path.join(dl, path.basename(src)));
    return { file: `downloads/${path.basename(src)}`, kind, size: fs.statSync(src).size };
  });
  const version = /_(\d+\.\d+\.\d+)_/.exec(path.basename(installers[0].src))?.[1] || '';
  fs.writeFileSync(path.join(dl, 'downloads.json'), JSON.stringify({ version, files }, null, 2));
  console.log(`installers → ${files.map(f => f.file).join(', ')}`);
} else {
  console.log('No desktop installers found (npm run desktop:build); the Download button will offer GitHub only.');
}

// Apache (DreamHost and most shared hosts): right types, long cache for hashed assets, never cache the page.
fs.writeFileSync(path.join(outDir, '.htaccess'), `# Standupify web demo
DirectoryIndex index.html
Options -Indexes

AddType application/manifest+json .webmanifest
AddType application/json .json
AddType text/javascript .js .mjs
AddType application/x-msdownload .exe
AddType application/x-msi .msi
AddType video/mp4 .mp4

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
  <FilesMatch "\\.(exe|msi)$">
    Header set Content-Disposition "attachment"
    Header set Cache-Control "public, max-age=3600"
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
