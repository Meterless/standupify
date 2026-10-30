import { useEffect, useState } from 'react';
import { AISettings } from '../types';
import { getCapabilities, Capabilities } from '../services/studio';
import { useEngines } from '../services/engines';

/** Changes when any Nightshift class gains or loses room. */
const classKey = (classes: Record<string, { availability: string | null }> | null) =>
  Object.entries(classes || {}).map(([k, v]) => `${k}:${v.availability}`).sort().join('|');

const EMPTY: Capabilities = { write: false, stills: null, clips: null, voice: false, music: false, imageRecipes: [], videoRecipes: [], reasons: {} };

/** What this machine can do right now; recomputed whenever an engine or workflow changes. */
export function useCapabilities(settings: AISettings): Capabilities {
  const eng = useEngines();
  const [caps, setCaps] = useState<Capabilities>(EMPTY);
  const [workflowsVersion, setWorkflowsVersion] = useState(0);

  useEffect(() => {
    const bump = () => setWorkflowsVersion(v => v + 1);
    window.addEventListener('standupify:comfy-changed', bump);
    return () => window.removeEventListener('standupify:comfy-changed', bump);
  }, []);

  useEffect(() => {
    let live = true;
    getCapabilities(settings).then(c => { if (live) setCaps(c); }).catch(() => { /* keep the last answer */ });
    return () => { live = false; };
  }, [eng.nightshift.state, classKey(eng.nightshift.classes), eng.comfy.state, eng.comfy.inventoryStamp, settings.imageEngine, settings.imageRecipe, settings.videoRecipe, workflowsVersion]);

  return caps;
}
