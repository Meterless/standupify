# Verification log

What was run on real hardware, when, and what came out. Reference rig: Windows 10, NVIDIA RTX 3090 (24 GB), 64 GB RAM, ComfyUI 0.42.0 (PyTorch 2.11 cu128), Nightshift (meterlessd 1.2.1) serving Gemma 4 E4B Q4_K_M, Node 22.16.

## 2026-10-30

| Check | Result | Evidence |
|---|---|---|
| `standupify_clip_ltxv.json` on real ComfyUI | Pass. 768×512, 97 frames, 24 fps, 4.04 s, H.264, from a Circuit stage still; 72 s including model load | [`verification/ltx-clip-2026-10-30.mp4`](verification/ltx-clip-2026-10-30.mp4) (carries its graph) |
| `standupify_original_plate_kontext.json` on real ComfyUI | Pass. Wide plate from Dez Okafor's master in 2.6 min of execution (3.9 min including queue wait) while the Circuit and the LLM shared the card. Jacket, stool, stage and grade held | [`verification/kontext-wide-2026-10-30.png`](verification/kontext-wide-2026-10-30.png), [`media/kontext-wide.jpg`](media/kontext-wide.jpg) |
| Station switched to LTX-Video for clips | Pass. The live Station rendered 8 LTX clips in its first 20 minutes and 10 by 04:20 PT (median 1.5 min per clip under load) | [`RECEIPTS.md`](RECEIPTS.md), measured render times |
| Private writers' room (`text.local`) | Pass. A real call returned from `local-runtime/gemma-4-e4b-it` in 21 s; Nightshift's signed receipt shows a `local` route | Nightshift `receipts.jsonl` on the rig |
| No hosted LLM in Standupify's history | Pass. 268 of 268 successful Standupify calls in Nightshift's receipts were served by local Gemma; Claude Sonnet appears only as the cost baseline | Nightshift `receipts.jsonl` on the rig |
| Provenance reader across the library | Pass. 152 of 156 Station media files carry a readable ComfyUI graph (60 FLUX.1 schnell stills, 84 Wan 2.2 clips, 8 LTX clips); the 4 without are 512×384 stills from the first day | `GET /api/station/provenance`, `npm run receipts` |
| In-app provenance panel | Pass. On Standupify TV, the badge read "LTX-Video 2B v0.9.5 · 768×512 · 97 frames @ 24 fps · 30 steps" and the panel listed all 15 nodes in execution order | Browser check |
| Real names in render prompts | Pass. 153 embedded prompts scanned for every two-word capitalized name in `services/league/masters.ts`: 0 matches | One-off scan with `services/comfy/provenance.ts` |
| `npm run typecheck` | Pass | |
| `npm test` | Pass. 24 node:test cases (19 existing + 5 new provenance and workflow checks) and 7 Night Shift checks, 0 failures | |

## 2026-10-25

| Check | Result | Evidence |
|---|---|---|
| 8-hour unattended soak (`npm run soak -- --hours 8 --video wan22-5b --original coverage`) | 69 new clips, 26 new stills, 14 new shows, one 12-minute Original premiered at 58 coverage shots. 45 failed tasks over 48 samples, mostly empty answers from the LLM while it was busy; none stopped the Station | [`verification/soak-2026-10-25.md`](verification/soak-2026-10-25.md) |
| Wan 2.2 5B shot time | About 7.7 min per 1280×704 shot alone, 7 to 8 min with Gemma on the same card | Soak log |

## Known failures

- Nightshift's `voice-tts` jobs failed on this rig (`engine_start_failed`); the TV and theater fall back to the browser voice.
- Nightshift's vision lane runs without its projector file, so reading a face from an image fails; Standupify detects this and stops sending images.
- `standupify_original_shot_ltxv-rife.json` needs ComfyUI-Frame-Interpolation, which is not installed on the rig; it has not been run.
