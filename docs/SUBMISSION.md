# Submission kit: Open Source Higgsfield

Form: https://form.typeform.com/to/V1dSQrkS · Deadline: **Friday Oct 30, 2026, 9:00 AM PT** · Rules: https://comfy.org/open-source-higgsfield

## Title and one sentence

**Standupify: The Comedy Network That Films Itself**

An open-source comedy network on one GPU: invented comedians write, compete and feud across a persistent, logged season; a local language model writes and judges, and ComfyUI films the sets that earn it on an eight-camera rig, with every frame carrying the graph that made it.

## Categories

| Prize | Enter? | What backs it |
|---|---|---|
| **Most Innovative** | Yes, primary | A persistent storyworld decides what gets filmed. Clips are consequences of logged events, not isolated prompts. |
| **Best Overall** | Automatic | Working app, `npm start` with zero config, local inference, multi-camera production, workflows in the repo, receipts. |
| **Open Weights Only** | Yes, in this configuration | Starter pack (FLUX.1 schnell + LTX-Video 2B) and Writers' room = **Private**, which routes every text call to Nightshift's on-device route. No API or partner nodes. Nightshift receipts: every Standupify call served by local Gemma 4 E4B. |
| **LTX VFX bonus** | Only if the video shows LTX shots | LTX-Video is the default clip recipe and every Circuit highlight since Oct 30 is an LTX image-to-video render (`standupify_clip_ltxv.json`). The Dez Original was shot on Wan 2.2: do not show it under the LTX claim. |
| FLUX bonus | No | Requires FLUX 3; Standupify ships FLUX.1. |

## Why it is new (say this, briefly)

1. **The scene decides what gets filmed.** Seeded rules and a logged league pick the moments; ComfyUI renders those, not random prompts.
2. **Every frame carries its receipts.** The app reads the ComfyUI graph out of each PNG and MP4 and shows it on screen; one click downloads the workflow that made the shot.
3. **One master plate, eight cameras.** Originals derive every angle from one plate, then a seeded director cuts on the beat. FLUX.1 Kontext keeps the far angles on-model.

## The 2-minute video

Judges score the work, not the editing. One screen recording plus narration is enough. Use only real footage from this machine and label simulated parts.

| Time | Beat | On screen | Say |
|---|---|---|---|
| 0:00 to 0:07 | **Cold open** | Full-screen Standupify TV: an animated set with captions, a laugh, a camera cut | (let it play; no voice for the first 4 seconds) |
| 0:07 to 0:15 | **Thesis** | Title card, then the Circuit board and the TV channel row | "I gave AI comedians a stage. Then they built a comedy industry. This is Standupify, and it runs on one GPU." |
| 0:15 to 0:35 | **The scandal** | Circuit Grapevine: night 45, Rafi accuses Tilly of lifting "The Jury of My Relatives", then *See the evidence*; night 47 both call each other out | "On night 45, Rafi accused Tilly of stealing a bit. The evidence is real: two sets that share whole runs of words. These comics are fictional and the crowd is simulated, but every event here is in the log." |
| 0:35 to 0:52 | **Consequences** | Night 47: Tilly wins the Championship at The Velvet Room (9.5), becomes Circuit Champion; the board; night 50 rematch request | "Two nights later Tilly won the championship. Rafi asked for a rematch. Nobody scripted that. Seeded rules over a persistent log decided it." |
| 0:52 to 1:20 | **ComfyUI proof** | Click the **ComfyUI** badge on a TV clip: LTX-Video 2B, 768×512, 97 frames, the 15-node graph. Cut to ComfyUI rendering a clip with its live preview (label any speed-up). Then `docs/media/original-plates.jpg` and `docs/media/kontext-wide.jpg` | "ComfyUI films what earned it. Every clip carries the exact graph that made it, read from the file. For specials, one master plate becomes eight cameras, and FLUX Kontext keeps the far angles on-model." |
| 1:20 to 1:37 | **The payoff** | Originals: "Dez Okafor: Live at Last" in the theater with captions and camera cuts | "Champions get an Original: a coverage-first 12-minute special, cut on the beat by a seeded director." |
| 1:37 to 1:50 | **Anyone can make one** | Studio: type one line, press Cast, the name and bits stream in (speed up and label it) | "Make your own comic from one line or a photo." |
| 1:50 to 2:00 | **Open source** | The repo README, `workflows/examples/`, MIT license, `npm start` | "It's MIT licensed, the workflows are in the repo, and it runs on your GPU. Clone it and start your own network." |

**Recording checklist**

- Writers' room **Private**, Clips **LTX-Video** (Engines sheet). Both are already set on this machine.
- Use `?clean` in the URL for footage without the ComfyUI badge; drop it for the proof beat.
- 1920×1080. If Nightshift shares the GPU, set Rehearsal drafts to 1 so live shows move.
- Do not say "179 shots" for the Original. Say "coverage-first 12-minute special" (58 of 179 planned shots rendered).
- Do not call the judges or the crowd human.

## Form answers (paste-ready)

- **Project name:** Standupify
- **Repo:** *(your public GitHub URL)*
- **Demo video:** *(your upload URL; check it plays in a private window)*
- **One-liner:** An open-source comedy network on one GPU. Invented comedians write, compete and feud; ComfyUI films the sets that earn it on an eight-camera rig.
- **Setup:** `npm start` (Node 18+). Engines: ComfyUI (`npm run setup:comfy`, or ComfyUI Desktop) and Nightshift (local model runtime from meterless.ai). No GPU: `npm run demo` runs on labelled mock engines.
- **Models:** FLUX.1 schnell (stills), LTX-Video 2B v0.9.5 (clips, default), Wan 2.2 TI2V 5B (optional clips), FLUX.1 Kontext dev (optional, face-locked camera angles), Gemma 4 E4B via Nightshift (writing and judging). All open weights.
- **ComfyUI workflows:** `workflows/examples/*.json` (API format, one per recipe). Every rendered file also embeds its own graph.
- **Proof:** `docs/RECEIPTS.md` (generated by `npm run receipts` from files on disk), `docs/VERIFICATION.md`.
- **License:** MIT

## Social post (draft)

> I built an AI comedy scene that runs on my GPU. Its comedians started accusing each other of stealing jokes, demanding rematches and winning championships. ComfyUI films the moments that earn it, on eight cameras from one master plate. Every frame carries the graph that made it. Open source, MIT.
>
> Video: *(link)* · Repo: *(link)*
>
> #OpenSourceHiggsfield @ComfyUI

## Compliance notes (checked 2026-10-30)

- **Open weights.** Every model `npm run setup:comfy` downloads is open weights; see the README's Models and licenses table. FLUX.1 Kontext dev and SDXL Turbo are open weights under non-commercial licenses and sit in optional packs. No ComfyUI API or partner nodes (enforced by `npm run test:provenance`).
- **No hosted LLMs.** Nightshift receipts for app `standupify`: 268 of 268 successful calls served by `local-runtime/gemma-4-e4b-it`. "Claude 4.5 Sonnet" appears in receipts only as the cost-savings baseline. With Writers' room = Private, every call uses `<class>.local`, Nightshift's on-device-only route.
- **Tauri shell** may only reach `127.0.0.1` and `localhost` (`src-tauri/capabilities/default.json`). `src-tauri/gen/` is stale generated output from the old Sitcomify build; leave it out of the public repo or rebuild it.
- **Characters and likeness.** All comics are invented. 153 embedded render prompts were scanned for every real name in the Masters' Playbook: zero matches.
- **LTX graph verified on real ComfyUI** (Oct 30): 768×512, 97 frames, 72 s including model load. Since then the live Station has rendered every Circuit highlight with LTX.
- **Kontext graph verified on real ComfyUI** (Oct 30): wide plate from Dez's master in 2.6 min of execution on the shared card; identity and wardrobe held.

## Before you press submit

- [ ] Public repo pushed; README images load on GitHub (`docs/media/*`)
- [ ] `.env.local`, `engines/`, `.backup/` are not in the repo (all gitignored)
- [ ] Video is 2:00 or less, public, plays in a private window
- [ ] Repo and video links filled in above and in the form
- [ ] Social post published with #OpenSourceHiggsfield
- [ ] Confirmation email or screen received before 9:00 AM PT
