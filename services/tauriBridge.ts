
// =====================================================================
// Tauri 2 bridge.
//
// The app runs as both a plain web SPA and a Tauri 2 desktop window.
// This module isolates the Tauri-only behavior so the web build stays
// untouched. All entry points are no-ops in the browser.
//
// Capabilities allowed by src-tauri/capabilities/default.json:
//   - fs:    write under $APPDATA/sitcomify/outbox/**
//   - dialog: native save/open dialogs
//   - opener: open external URLs in the user's default browser
//   - http:  CORS-free fetches to *.googleapis.com / api.openai.com
//
// Anything beyond those globs/permissions will be denied by Tauri.
// =====================================================================

import type { PublishableAsset } from '../types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

interface FsApi {
  writeTextFile: (path: string, content: string, opts?: any) => Promise<void>;
  writeFile: (path: string, contents: Uint8Array, opts?: any) => Promise<void>;
  mkdir: (path: string, opts?: { baseDir?: number; recursive?: boolean }) => Promise<void>;
  exists: (path: string, opts?: { baseDir?: number }) => Promise<boolean>;
  BaseDirectory: { AppData: number };
}

// Lazy + cached so the web build never executes the import.
let _fsPromise: Promise<FsApi> | null = null;
function loadFs(): Promise<FsApi> {
  if (!_fsPromise) {
    _fsPromise = import('@tauri-apps/plugin-fs') as unknown as Promise<FsApi>;
  }
  return _fsPromise;
}

let _openerPromise: Promise<{ openUrl: (url: string) => Promise<void> }> | null = null;
function loadOpener() {
  if (!_openerPromise) {
    _openerPromise = import('@tauri-apps/plugin-opener') as any;
  }
  return _openerPromise;
}

// Open an external URL via the OS browser (Tauri) or window.open (web).
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const opener = await loadOpener();
      await opener.openUrl(url);
      return;
    } catch (err) {
      console.warn('Tauri opener failed, falling back to window.open', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function safeSlug(s: string): string {
  return s.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60) || 'asset';
}

function extFromDataUri(uri: string, fallback: string): string {
  const m = /^data:([^;,]+)[;,]/.exec(uri);
  if (!m) return fallback;
  const mime = m[1].toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  return fallback;
}

function dataUriToBytes(uri: string): Uint8Array | null {
  const idx = uri.indexOf('base64,');
  if (idx === -1) return null;
  const b64 = uri.slice(idx + 'base64,'.length);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// =====================================================================
// Outbox: write a PublishableAsset to $APPDATA/openmic/outbox/<comedian>/<id>/
// in addition to whatever IndexedDB record the Publisher already made.
// No-op in the web build.
// =====================================================================

export interface OutboxDiskWrite {
  dir: string;
  files: string[];
}

export async function writeAssetToDiskOutbox(
  outboxId: string,
  asset: PublishableAsset
): Promise<OutboxDiskWrite | null> {
  if (!isTauri()) return null;

  let fs: FsApi;
  try {
    fs = await loadFs();
  } catch (err) {
    console.warn('Tauri fs plugin unavailable', err);
    return null;
  }

  const appData = fs.BaseDirectory.AppData;
  const baseDir = `openmic/outbox/${safeSlug(asset.comedianId)}`;
  const itemDir = `${baseDir}/${safeSlug(outboxId)}`;
  const files: string[] = [];

  try {
    await fs.mkdir(itemDir, { baseDir: appData, recursive: true });
  } catch (err) {
    console.warn('Outbox mkdir failed', err);
    return null;
  }

  // manifest.json — the canonical record.
  const manifest = {
    outboxId,
    comedianId: asset.comedianId,
    setId: asset.setId,
    refId: asset.refId,
    kind: asset.kind,
    title: asset.title,
    caption: asset.caption,
    submittedAt: Date.now()
  };
  try {
    await fs.writeTextFile(`${itemDir}/manifest.json`, JSON.stringify(manifest, null, 2), { baseDir: appData });
    files.push('manifest.json');
  } catch (err) {
    console.warn('manifest write failed', err);
  }

  // caption.txt — convenient for the maintainer copy/pasting into YouTube.
  if (asset.caption) {
    try {
      await fs.writeTextFile(`${itemDir}/caption.txt`, asset.caption, { baseDir: appData });
      files.push('caption.txt');
    } catch (err) {
      console.warn('caption write failed', err);
    }
  }

  // Pre-rendered HTML payload if the asset has one (e.g. show page).
  if (asset.bodyHtml) {
    try {
      await fs.writeTextFile(`${itemDir}/body.html`, asset.bodyHtml, { baseDir: appData });
      files.push('body.html');
    } catch (err) {
      console.warn('body html write failed', err);
    }
  }

  // Binary assets — decode data URIs and persist as real files.
  if (asset.imageUrl?.startsWith('data:')) {
    const bytes = dataUriToBytes(asset.imageUrl);
    if (bytes) {
      const name = `image.${extFromDataUri(asset.imageUrl, 'png')}`;
      try {
        await fs.writeFile(`${itemDir}/${name}`, bytes, { baseDir: appData });
        files.push(name);
      } catch (err) {
        console.warn('image write failed', err);
      }
    }
  }
  if (asset.videoUrl?.startsWith('data:')) {
    const bytes = dataUriToBytes(asset.videoUrl);
    if (bytes) {
      const name = `video.${extFromDataUri(asset.videoUrl, 'mp4')}`;
      try {
        await fs.writeFile(`${itemDir}/${name}`, bytes, { baseDir: appData });
        files.push(name);
      } catch (err) {
        console.warn('video write failed', err);
      }
    }
  }

  return { dir: itemDir, files };
}
