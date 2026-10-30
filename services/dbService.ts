
import { Comedian, Set, AISettings } from '../types';
import { getRepository, ensureMigrations, getLatestSet } from './repository';

// Thin convenience wrappers used by App.tsx. Everything goes through the
// Repository abstraction; migration is ensured before any read.

export async function getAllComedians(): Promise<Comedian[]> {
  await ensureMigrations();
  return getRepository().listComedians();
}

export async function saveComedian(c: Comedian): Promise<void> {
  await ensureMigrations();
  return getRepository().saveComedian(c);
}

export async function deleteComedian(id: string): Promise<void> {
  await ensureMigrations();
  return getRepository().deleteComedian(id);
}

export async function listSets(comedianId: string): Promise<Set[]> {
  await ensureMigrations();
  return getRepository().listSets(comedianId);
}

export async function getLatestSetFor(comedianId: string): Promise<Set | undefined> {
  await ensureMigrations();
  return getLatestSet(comedianId);
}

export async function saveSet(s: Set): Promise<void> {
  await ensureMigrations();
  return getRepository().saveSet(s);
}

export async function deleteSet(id: string): Promise<void> {
  await ensureMigrations();
  return getRepository().deleteSet(id);
}

export async function saveSettings(settings: AISettings): Promise<void> {
  return getRepository().saveSettings(settings);
}

export async function getSettings(): Promise<AISettings> {
  return getRepository().getSettings();
}
