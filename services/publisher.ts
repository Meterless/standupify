
import {
  PublishTarget, PublishableAsset, PublishedResult, OutboxItem, PostMetrics, Set
} from '../types';
import { getRepository } from './repository';
import { isTauri, writeAssetToDiskOutbox } from './tauriBridge';

// =====================================================================
// Publisher interface — the v2 cloud bridge for distribution.
//
// v1: writes to a local IndexedDB outbox.
// v2: server-side publishing service per comedian channel.
// =====================================================================

export interface Publisher {
  post(target: PublishTarget, asset: PublishableAsset): Promise<PublishedResult>;
  getMetrics(url: string): Promise<PostMetrics>;
  listOutbox(comedianId?: string): Promise<OutboxItem[]>;
}

// A stable 128-bit FNV-1a key keeps Windows filenames and Tauri's 60-character
// directory slugs short. Hash every UTF-16 byte, including the end of long IDs.
function outboxId(key: string): string {
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  const prime = 0x1000000000000000000013bn;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    hash = BigInt.asUintN(128, (hash ^ BigInt(code & 0xff)) * prime);
    hash = BigInt.asUintN(128, (hash ^ BigInt(code >>> 8)) * prime);
  }
  return `outbox_${hash.toString(16).padStart(32, '0')}`;
}

export class OutboxPublisher implements Publisher {
  private submissions = new Map<string, Promise<PublishedResult>>();

  async post(target: PublishTarget, asset: PublishableAsset): Promise<PublishedResult> {
    const now = Date.now();
    if (target.kind === 'openmic_network_outbox') {
      const key = JSON.stringify([asset.comedianId, asset.kind, asset.refId]);
      const pending = this.submissions.get(key);
      if (pending) return pending;
      const submission = this.saveToOutbox(target, asset, key).finally(() => { this.submissions.delete(key); });
      this.submissions.set(key, submission);
      return submission;
    }
    if (target.kind === 'local_download') {
      // The download is triggered by the caller's UI; the Publisher just
      // records the action for analytics symmetry with v2.
      return { target, publishedAt: now };
    }
    if (target.kind === 'manual_link') {
      return { target, url: target.url, publishedAt: now };
    }
    throw new Error('Unknown publish target');
  }

  private async saveToOutbox(target: PublishTarget, asset: PublishableAsset, key: string): Promise<PublishedResult> {
    const repo = getRepository();
    // Reuse legacy rows as well as deterministic new IDs. A partial submission
    // can be retried without duplicating assets or resetting review decisions.
    let item = (await repo.listOutbox(asset.comedianId)).find(o => o.asset.kind === asset.kind && o.asset.refId === asset.refId);
    if (!item) {
      item = { id: outboxId(key), comedianId: asset.comedianId, asset, submittedAt: Date.now(), reviewed: false };
      await repo.saveOutboxItem(item);
    }
    // A crash after the repository write can still finish the desktop copy.
    if (isTauri() && !item.reviewerNote?.startsWith('disk:')) {
      const disk = await writeAssetToDiskOutbox(item.id, item.asset);
      if (disk) {
        item.reviewerNote = `disk:${disk.dir}`;
        await repo.saveOutboxItem(item);
      }
    }
    return { target, outboxId: item.id, publishedAt: item.submittedAt };
  }

  // v1 has no live metrics. Users can paste a YouTube URL on the set and
  // the Analytics Agent records it as a manual snapshot — that path
  // bypasses this method.
  async getMetrics(_url: string): Promise<PostMetrics> {
    return {};
  }

  async listOutbox(comedianId?: string): Promise<OutboxItem[]> {
    return getRepository().listOutbox(comedianId);
  }
}

let _publisher: Publisher | null = null;
export function getPublisher(): Publisher {
  if (!_publisher) _publisher = new OutboxPublisher();
  return _publisher;
}

// Convenience: assemble PublishableAssets for a Set and push them to the
// outbox in one call. Used by the approval flow.
export async function submitSetToOutbox(set: Set): Promise<OutboxItem[]> {
  const repo = getRepository();
  const pub = getPublisher();
  const items: OutboxItem[] = [];

  // The set itself.
  const setAsset: PublishableAsset = {
    kind: 'set',
    comedianId: set.comedianId,
    setId: set.id,
    refId: set.id,
    title: set.title,
    caption: set.logline,
    imageUrl: set.bits[0]?.imageUrl,
    videoUrl: set.bits[0]?.videoUrl
  };
  const setResult = await pub.post({ kind: 'openmic_network_outbox' }, setAsset);
  if (setResult.outboxId) {
    const it = (await repo.listOutbox(set.comedianId)).find(o => o.id === setResult.outboxId);
    if (it) items.push(it);
  }

  // Clips.
  const clips = await repo.listClips(set.comedianId);
  for (const c of clips.filter(x => x.setId === set.id)) {
    const a: PublishableAsset = {
      kind: 'clip',
      comedianId: c.comedianId,
      setId: c.setId,
      refId: c.id,
      title: c.title,
      caption: c.caption,
      imageUrl: c.thumbnailUrl || c.imageUrl,
      videoUrl: c.videoUrl
    };
    const r = await pub.post({ kind: 'openmic_network_outbox' }, a);
    if (r.outboxId) {
      const it = (await repo.listOutbox(set.comedianId)).find(o => o.id === r.outboxId);
      if (it) items.push(it);
    }
    const fresh = await repo.getClip(c.id);
    if (fresh && fresh.status !== 'published' && fresh.status !== 'submitted') {
      fresh.status = 'submitted';
      await repo.saveClip(fresh);
    }
  }

  return items;
}
