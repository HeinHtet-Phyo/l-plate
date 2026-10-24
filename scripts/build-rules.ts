// pnpm build:rules [--parse-only] — fetch the Highway Code from gov.uk, split it into rules, embed each on Nebius.
// Output (committed): apps/server/data/highway-code.json, read by apps/server/src/rules.ts.
// HTML is cached under scripts/.cache/highway-code/ (gitignored); delete it to re-download.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createNebius } from '../apps/server/src/nebius.ts';

const OUT = 'apps/server/data/highway-code.json';
const CACHE = 'scripts/.cache/highway-code';
const BASE = 'https://www.gov.uk/guidance/the-highway-code';
const MODEL = process.env.NEBIUS_MODEL_EMBED || 'Qwen/Qwen3-Embedding-8B';
const BATCH = 32;
const parseOnly = process.argv.includes('--parse-only');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The numbered-rule sections (1–307). Annexes and sign pages carry no rule numbers, so they are skipped.
const SECTIONS = [
  'rules-for-pedestrians-1-to-35',
  'rules-for-users-of-powered-wheelchairs-and-mobility-scooters-36-to-46',
  'rules-about-animals-47-to-58',
  'rules-for-cyclists-59-to-82',
  'rules-for-motorcyclists-83-to-88',
  'rules-for-drivers-and-motorcyclists-89-to-102',
  'general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158',
  'using-the-road-159-to-203',
  'road-users-requiring-extra-care-204-to-225',
  'driving-in-adverse-weather-conditions-226-to-237',
  'waiting-and-parking-238-to-252',
  'motorways-253-to-273',
  'breakdowns-and-incidents-274-to-287',
  'road-works-level-crossings-and-tramways-288-to-307',
];

interface Rule {
  rule: string;
  title: string;
  text: string;
}

async function page(slug: string): Promise<string> {
  const file = `${CACHE}/${slug}.html`;
  if (existsSync(file)) return readFileSync(file, 'utf8');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/${slug}`, { headers: { 'User-Agent': 'l-plate build-rules (hackathon)' } });
    if (res.ok) {
      const html = await res.text();
      writeFileSync(file, html);
      await sleep(300);
      return html;
    }
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`gov.uk ${slug}: HTTP ${res.status}`);
    await sleep(1000 * 2 ** attempt);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', pound: '£', deg: '°' };

export function htmlToText(html: string): string {
  return html
    .replace(/<div class="call-to-action">[\s\S]*?<\/div>/gi, ' ')
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/<\/(p|li|h\d|figcaption|tr|div)>/gi, ' ')
    .replace(/<li[^>]*>/gi, ' • ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

const cleanHeading = (h: string) =>
  htmlToText(h)
    .replace(/\s*\((rules?\s*)?\d+[a-z]?(\s*(to|and|-|–)\s*\d+[a-z]?)?\)\s*$/i, '')
    .trim();

// Walk the page's h2/h3/h4 headings in order. h2 = section ("Road junctions"); "Rule N" headings start a rule;
// any other h3/h4 is a sub-heading ("Turning right") that ends the current rule and refines the title.
export function parseRules(html: string): Rule[] {
  const start = html.indexOf('<main');
  const end = html.indexOf('</main>');
  const body = html.slice(start < 0 ? 0 : start, end < 0 ? html.length : end);
  const heads = [...body.matchAll(/<(h[234])\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const out: Rule[] = [];
  let section = '';
  let sub = '';
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const text = htmlToText(h[2]);
    const m = text.match(/^Rule\s+(\d+[a-z]?)$/i);
    if (!m) {
      if (h[1].toLowerCase() === 'h2') {
        section = cleanHeading(h[2]);
        sub = '';
      } else sub = cleanHeading(h[2]);
      continue;
    }
    const from = h.index + h[0].length;
    const to = i + 1 < heads.length ? heads[i + 1].index : body.length;
    // Cut at the end of the accordion section so the next section's chrome doesn't leak in.
    let chunk = body.slice(from, to);
    const cut = chunk.search(/<div[^>]*govuk-accordion__section(-header)?["\s]/i);
    if (cut >= 0) chunk = chunk.slice(0, cut);
    const ruleText = htmlToText(chunk);
    if (!ruleText) continue;
    out.push({ rule: m[1], title: sub && sub !== section ? `${section}: ${sub}` : section, text: ruleText });
  }
  return out;
}

function loadKey(): string {
  if (!process.env.NEBIUS_API_KEY && existsSync('.env')) process.loadEnvFile('.env');
  const key = process.env.NEBIUS_API_KEY;
  if (!key) throw new Error('NEBIUS_API_KEY is not set (put it in the repo-root .env).');
  return key;
}

const round = (x: number) => Number(x.toPrecision(5));

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const rules: Rule[] = [];
  for (const slug of SECTIONS) {
    const got = parseRules(await page(slug));
    console.log(`${slug}: ${got.length} rules`);
    rules.push(...got);
  }
  const seen = new Set<string>();
  const unique = rules.filter((r) => (seen.has(r.rule) ? false : (seen.add(r.rule), true)));
  const nums = new Set(unique.map((r) => parseInt(r.rule, 10)));
  const missing: number[] = [];
  for (let n = 1; n <= 307; n++) if (!nums.has(n)) missing.push(n);
  console.log(`parsed ${unique.length} rules${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
  for (const n of ['126', '170']) {
    const r = unique.find((x) => x.rule === n);
    console.log(`  rule ${n} [${r?.title}]: ${r?.text.slice(0, 100)}…`);
  }
  if (parseOnly) return;

  const client = createNebius({ apiKey: loadKey(), timeoutMs: 120_000, retries: 5, backoffMs: 2000 });
  const chunks: (Rule & { v: number[] })[] = [];
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const res = await client.embed(MODEL, batch.map((r) => `Rule ${r.rule}: ${r.title}. ${r.text}`));
    const byIndex = [...res.data].sort((a, b) => a.index - b.index);
    if (byIndex.length !== batch.length) throw new Error(`embed returned ${byIndex.length} vectors for ${batch.length} inputs`);
    batch.forEach((r, j) => chunks.push({ ...r, v: byIndex[j].embedding.map(round) }));
    console.log(`embedded ${chunks.length}/${unique.length}`);
  }
  mkdirSync('apps/server/data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ model: MODEL, chunks }));
  console.log(`wrote ${OUT}: ${chunks.length} chunks × ${chunks[0]?.v.length} dims, ${(statSync(OUT).size / 1e6).toFixed(1)} MB`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
