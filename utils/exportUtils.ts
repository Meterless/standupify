import { Comedian, Set } from '../types';
import { getRepository } from '../services/repository';

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// The Station serves media as files; exports carry the bytes so they work anywhere.
const STATION_MEDIA = /^(\.?\/)?api\/station\/media\//;
async function inline(u: string | null | undefined): Promise<string | null> {
  if (!u || !STATION_MEDIA.test(u)) return u || null;
  try {
    const blob = await (await fetch(u)).blob();
    return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
  } catch { return u; }
}
async function inlineDeep<T>(v: T): Promise<T> {
  if (typeof v === 'string') return (STATION_MEDIA.test(v) ? await inline(v) : v) as T;
  if (Array.isArray(v)) return Promise.all(v.map(inlineDeep)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, x] of Object.entries(v)) out[k] = await inlineDeep(x);
    return out;
  }
  return v;
}

const slug = (s: string) => (s || 'standupify').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');

/** One comedian + one set as JSON (re-importable from the Roster). */
export async function exportSpecialJson(comedian: Comedian, set: Set) {
  download(`${slug(comedian.name)}_${slug(set.title)}.json`, new Blob([JSON.stringify(await inlineDeep({ comedian, set }), null, 2)], { type: 'application/json' }));
}

/** Every comedian with every set, clip and promo. */
export async function exportRosterBackup() {
  const repo = getRepository();
  const comedians = await repo.listComedians();
  const sets: Set[] = [], clips: unknown[] = [], promos: unknown[] = [];
  for (const c of comedians) {
    sets.push(...await repo.listSets(c.id));
    clips.push(...await repo.listClips(c.id));
    promos.push(...await repo.listPromos(c.id));
  }
  const date = new Date().toISOString().slice(0, 10);
  download(`Standupify_Roster_${date}.json`, new Blob([JSON.stringify(await inlineDeep({ kind: 'standupify_backup', comedians, sets, clips, promos }))], { type: 'application/json' }));
}

/** A single HTML file that plays the whole special offline: clips, voice, captions. */
export async function exportSpecialHtml(comedian: Comedian, set: Set) {
  const data = {
    name: comedian.name,
    tagline: comedian.tagline,
    title: set.title,
    headshot: await inline(comedian.headshotUrl || comedian.avatarImage),
    walkOn: await inline(comedian.walkOnUrl),
    bits: await Promise.all(set.bits.map(async b => ({ title: b.title, text: b.description, image: await inline(b.imageUrl), video: await inline(b.videoUrl), audio: await inline(b.audioUrl), laugh: b.laughScore ?? null })))
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(comedian.name)} — ${esc(set.title)}</title>
<style>
*{box-sizing:border-box;margin:0}body{background:#0b0b0c;color:#f3efe6;font:16px/1.5 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
.wrap{width:min(1100px,100%)}h1{font:400 clamp(36px,6vw,72px)/1 Georgia,serif;letter-spacing:-.01em}.sub{color:#9a958c;font-style:italic;margin:.5em 0 1.5em}
.stage{position:relative;aspect-ratio:16/9;border-radius:22px;overflow:hidden;background:#000;border:1px solid #ffffff18}
.stage img,.stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.stage img{animation:push 9s ease-out forwards}
@keyframes push{to{transform:scale(1.18)}}
.cap{position:absolute;inset:auto 0 0;padding:64px 32px 28px;background:linear-gradient(transparent,#000d);text-align:center;font-size:clamp(16px,2.2vw,24px);font-weight:600;text-shadow:0 2px 10px #000}
.tag{position:absolute;top:16px;left:16px;background:#0009;border-radius:99px;padding:6px 14px;font-size:13px}
.laugh{position:absolute;top:16px;right:16px;background:#0009;border-radius:99px;padding:6px 14px;font:13px ui-monospace,monospace;color:#ffb547}
.intro{position:absolute;inset:0;display:grid;place-items:center;text-align:center;background:radial-gradient(ellipse at 50% 15%,#ffb54733,transparent 60%),#120d09}
.intro b{display:block;font:400 clamp(48px,9vw,110px)/1 Georgia,serif}
button{margin-top:18px;background:#ffb547;color:#1d1407;border:0;border-radius:99px;padding:14px 28px;font-weight:600;font-size:16px;cursor:pointer}
footer{margin-top:16px;color:#615d57;font-size:12px}
</style></head><body><div class="wrap">
<h1>${esc(comedian.name)}</h1><p class="sub">“${esc(set.title)}” — ${esc(comedian.tagline)}</p>
<div class="stage" id="stage"><div class="intro"><div><small style="letter-spacing:.2em;text-transform:uppercase;color:#fff9">Please welcome to the stage</small><b>${esc(comedian.name)}</b></div></div></div>
<button id="play">▶ Play the special</button>
<footer>Made with Standupify — Nightshift wrote it, ComfyUI shot it.</footer></div>
<script>
const D=${json};const stage=document.getElementById('stage');const btn=document.getElementById('play');const audio=new Audio();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function show(b,i){stage.innerHTML='';let m;if(b.video&&b.video.startsWith('data:image/')){m=document.createElement('img');m.src=b.video;m.style.animation='none'}else if(b.video){m=document.createElement('video');m.src=b.video;m.autoplay=true;m.loop=true;m.muted=true;m.playsInline=true}else if(b.image){m=document.createElement('img');m.src=b.image}if(m)stage.appendChild(m);
const t=document.createElement('div');t.className='tag';t.textContent=(i+1)+'/'+D.bits.length+' · '+b.title;stage.appendChild(t);
if(b.laugh!=null){const l=document.createElement('div');l.className='laugh';l.textContent='laugh '+b.laugh.toFixed(1);stage.appendChild(l)}
const c=document.createElement('div');c.className='cap';c.textContent=b.text;stage.appendChild(c)}
async function run(){btn.disabled=true;if(D.walkOn){audio.src=D.walkOn;audio.play().catch(()=>{});await sleep(5000);audio.pause()}
for(let i=0;i<D.bits.length;i++){const b=D.bits[i];show(b,i);if(b.audio){audio.src=b.audio;await new Promise(r=>{audio.onended=r;audio.play().catch(r)})}else await sleep(Math.max(4000,b.text.length*60));await sleep(1200)}
btn.disabled=false;btn.textContent='↺ Play again'}
btn.onclick=run;
</script></body></html>`;
  download(`${slug(comedian.name)}_${slug(set.title)}.html`, new Blob([html], { type: 'text/html' }));
}
