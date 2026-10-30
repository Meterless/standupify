// =====================================================================
// Compatibility shim for the Night Shift agents (clipper, promoter, scout).
// Everything routes through the studio: Nightshift writes, ComfyUI shoots.
// =====================================================================

import { AISettings } from '../types';
import { writeBit, riff, inventMaterial, renderStill } from './studio';

export type AITask = 'writeBit' | 'generateImage' | 'riff' | 'generateMaterial';

export async function runAIService(settings: AISettings, task: AITask, data: any): Promise<any> {
  switch (task) {
    case 'writeBit': {
      const bit = await writeBit(data.comedian, data.set, data.userInstruction, settings);
      return { ...bit, visualPrompt: bit.action };
    }
    case 'riff':
      return { instruction: await riff(data.comedian, data.set, settings) };
    case 'generateMaterial':
      return inventMaterial(data.comedian, data.existingMaterial || [], settings);
    case 'generateImage':
      return renderStill(data.prompt, settings, { label: data.label || 'Promo poster', itemKey: data.itemKey || `img:${data.prompt.slice(0, 80)}` });
  }
}
