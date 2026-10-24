// pnpm textures:generate — London facade/roof/ground textures.
// Generation: Gemini image model (GEMINI_API_KEY; offline only, outputs committed — see DECISIONS.md).
// Review: a Nebius Token Factory vision model checks each image and returns JSON; failures are regenerated
// up to 4 times with the issues fed back into the prompt.
// Output: apps/web/public/textures/<id>.<ext> + manifest.json. The app uses them when present.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? '';
const NEBIUS_KEY = process.env.NEBIUS_API_KEY ?? '';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image';
const REVIEW_MODEL = process.env.NEBIUS_MODEL_VISION ?? 'Qwen/Qwen3.8-27B';
const OUT = 'apps/web/public/textures';
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const force = process.argv.includes('--force');

const BASE =
  'Seamless tileable architectural facade texture: a perfectly flat, orthographic front elevation, no perspective, soft even overcast light, filling the frame edge to edge, no sky, ground or border, left and right edges continue seamlessly. Photorealistic. No people, vehicles, trees, street furniture, text, logos or watermarks.';
const UPPER = 'Exactly three window bays wide and three storeys tall.';
const GROUND = 'One storey tall and three bays wide.';

const STYLES: Record<string, string> = {
  'georgian-brick': 'London Georgian terrace: yellow-grey London stock brick in Flemish bond with white-painted timber sash windows (six-over-six), flat gauged-brick arches, slim stone sills.',
  'victorian-red': 'London Victorian terrace: red brick with cream stone window surrounds and sills, white two-over-two sash windows.',
  'stucco-white': 'London Regency stucco terrace (Belgravia / Notting Hill): smooth cream-white painted stucco with horizontal rustication lines, white sash windows with moulded surrounds and cornices.',
  'portland-stone': 'Pale Portland stone classical London building (Whitehall / Regent Street): ashlar stone blocks, tall dark multi-pane windows with carved stone architraves.',
  'office-glass': 'Modern City of London office curtain wall: grey-blue reflective glass panels with slim aluminium mullions and transoms in a regular grid.',
  'modern-flats': 'Modern London apartment block: buff brick with horizontal concrete floor bands and dark grey aluminium casement windows.',
  'warehouse-brick': 'Victorian London warehouse (Shad Thames / Clerkenwell): dark brown-grey stock brick with tall arched windows with dark iron frames.',
};

const GROUND_EXTRA: Record<string, string> = {
  'georgian-brick': 'Ground floor of the same terrace: a glossy black panelled front door with a semicircular fanlight in the middle bay, sash windows either side, black iron railings along the bottom.',
  'victorian-red': 'Ground floor of the same terrace: a bay window, a coloured panelled front door with a stained-glass top light, red brick.',
  'stucco-white': 'Ground floor of the same stucco terrace: a columned porch around a black front door, rusticated stucco, sash windows, black railings.',
  'portland-stone': 'Ground floor of the same Portland stone building: heavy rusticated stone base with tall windows and a central doorway.',
  'office-glass': 'Ground floor lobby of the same office: full-height clear glass entrance with slim steel frames.',
  'modern-flats': 'Ground floor of the same block: buff brick with a glazed entrance door and windows.',
  'warehouse-brick': 'Ground floor of the same warehouse: arched loading doors and windows in dark stock brick.',
  shopfront: 'A row of three traditional London high-street shopfronts: painted timber fascia boards (blank, no lettering), large plate-glass display windows, recessed doors, stall risers.',
};

interface Job {
  id: string;
  prompt: string;
  aspect: '1:1' | '21:9';
  checks: string;
}

function jobs(): Job[] {
  const list: Job[] = [];
  for (const [s, d] of Object.entries(STYLES)) {
    list.push({ id: `upper-${s}`, prompt: `${BASE} ${d} ${UPPER}`, aspect: '1:1', checks: `${d} ${UPPER}` });
    list.push({ id: `ground-${s}`, prompt: `${BASE} ${GROUND_EXTRA[s]} ${GROUND}`, aspect: '21:9', checks: `${GROUND_EXTRA[s]} ${GROUND}` });
  }
  list.push({ id: 'ground-shopfront', prompt: `${BASE} ${GROUND_EXTRA.shopfront} ${GROUND}`, aspect: '21:9', checks: GROUND_EXTRA.shopfront });
  const flat = 'Seamless tileable texture, perfectly flat top-down orthographic view, even overcast light, filling the frame edge to edge, all four edges continue seamlessly. Photorealistic. No objects, people, vehicles, text, logos or watermarks.';
  list.push({ id: 'slate', prompt: `${flat} Welsh slate roof tiles in overlapping courses, dark blue-grey, as on London terraced houses.`, aspect: '1:1', checks: 'Welsh slate roof tiles, top-down' });
  list.push({ id: 'flat', prompt: `${flat} Flat roof covering: grey bitumen felt with fine gravel, as on London flat roofs.`, aspect: '1:1', checks: 'Grey flat roof felt with gravel, top-down' });
  list.push({ id: 'asphalt', prompt: `${flat} London road asphalt: dark grey worn tarmac with fine aggregate, no road markings.`, aspect: '1:1', checks: 'Dark asphalt road surface, no markings' });
  list.push({ id: 'paving', prompt: `${flat} London pavement: square grey concrete paving slabs, about 4 by 4 slabs across, thin joints.`, aspect: '1:1', checks: 'Grey square concrete paving slabs' });
  return list;
}

async function generate(prompt: string, aspect: string): Promise<{ mime: string; data: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    const j = (await res.json()) as any;
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(j.error ?? j).slice(0, 200)}`);
    const part = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (part) return { mime: part.inlineData.mimeType, data: part.inlineData.data };
    throw new Error(`Gemini returned no image (${j.candidates?.[0]?.finishReason ?? 'unknown'})`);
  }
  throw new Error('Gemini kept failing');
}

interface Review {
  front_on: boolean;
  matches: boolean;
  fills_frame: boolean;
  has_people: boolean;
  has_vehicles: boolean;
  has_text: boolean;
  issues: string[];
}

async function review(img: { mime: string; data: string }, expected: string): Promise<Review> {
  const res = await fetch('https://api.tokenfactory.nebius.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${NEBIUS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: REVIEW_MODEL,
      temperature: 0,
      max_tokens: 1200,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You review textures for a 3D London driving game. Expected: ${expected}
Answer ONLY with JSON: {"front_on": bool (flat orthographic, no perspective), "matches": bool (matches the expected description), "fills_frame": bool (texture fills the whole frame, no sky/ground/border), "has_people": bool, "has_vehicles": bool, "has_text": bool (any lettering, logos or watermarks), "issues": [short strings describing what to fix]}`,
            },
            { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(`Nebius review HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = String(j.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?|```$/g, '').trim();
  const r = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return { front_on: !!r.front_on, matches: !!r.matches, fills_frame: !!r.fills_frame, has_people: !!r.has_people, has_vehicles: !!r.has_vehicles, has_text: !!r.has_text, issues: Array.isArray(r.issues) ? r.issues.map(String) : [] };
}

const score = (r: Review) => [r.front_on, r.matches, r.fills_frame, !r.has_people, !r.has_vehicles, !r.has_text].filter(Boolean).length;

async function run(job: Job, manifest: Record<string, unknown>) {
  let best: { img: { mime: string; data: string }; rev: Review; attempt: number } | null = null;
  let prompt = job.prompt;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const img = await generate(prompt, job.aspect);
    let rev: Review;
    try {
      rev = await review(img, job.checks);
    } catch (e) {
      console.warn(`  ${job.id}: review failed (${(e as Error).message}); keeping image unreviewed`);
      rev = { front_on: true, matches: true, fills_frame: true, has_people: false, has_vehicles: false, has_text: false, issues: ['not reviewed'] };
    }
    if (!best || score(rev) > score(best.rev)) best = { img, rev, attempt };
    console.log(`  ${job.id} attempt ${attempt}: score ${score(rev)}/6 ${rev.issues.length ? `issues: ${rev.issues.join('; ').slice(0, 160)}` : ''}`);
    if (score(rev) === 6) break;
    prompt = `${job.prompt} Fix these problems from the previous attempt: ${rev.issues.join('; ')}.`;
  }
  const ext = best!.img.mime.includes('jpeg') ? 'jpg' : best!.img.mime.includes('webp') ? 'webp' : 'png';
  const file = `${job.id}.${ext}`;
  writeFileSync(`${OUT}/${file}`, Buffer.from(best!.img.data, 'base64'));
  manifest[job.id] = { file, aspect: job.aspect, model: IMAGE_MODEL, reviewer: REVIEW_MODEL, review: best!.rev, attempts: best!.attempt };
}

async function main() {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set');
  if (!NEBIUS_KEY) console.warn('NEBIUS_API_KEY not set: images will not be reviewed');
  mkdirSync(OUT, { recursive: true });
  const mfile = `${OUT}/manifest.json`;
  const manifest: Record<string, unknown> = existsSync(mfile) ? JSON.parse(readFileSync(mfile, 'utf8')) : {};
  const todo = jobs().filter((j) => (!only.length || only.includes(j.id)) && (force || !manifest[j.id]));
  console.log(`Generating ${todo.length} textures with ${IMAGE_MODEL}, reviewed by ${REVIEW_MODEL}…`);
  const queue = [...todo];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        await run(job, manifest);
        writeFileSync(mfile, JSON.stringify(manifest, null, 1));
      } catch (e) {
        console.error(`  ${job.id} FAILED: ${(e as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
  writeFileSync(mfile, JSON.stringify(manifest, null, 1));
  console.log(`Done: ${Object.keys(manifest).length} textures in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
