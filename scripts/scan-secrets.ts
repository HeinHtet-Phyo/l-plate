// pnpm scan-secrets [--staged] [--repo <path>] — look for leaked secrets in what git tracks.
//
//   (default)   scan the index (every tracked/staged file's staged contents) AND the whole history
//               (every line ever added in any commit reachable from any ref, incl. deleted files).
//   --staged    index only — fast enough for a pre-commit hook:
//                 node scripts/scan-secrets.ts --staged || exit 1
//               (no hook is installed by this repo; wire it up yourself if you want one).
//   --repo <p>  scan the git repo at <p> instead of the cwd.
//
// Exit 0 = clean, 1 = findings (printed with file, commit, line, rule and a redacted preview showing
// only the first 4 chars), 2 = usage / git error.
//
// Only git objects are read (index blobs via `git cat-file`, history via `git log -p`), so untracked
// and gitignored files such as the real root .env are never opened. The index contents are a superset
// of `git diff --cached`, so scanning them covers whatever is staged.
//
// Rules: strong-format key shapes (Nebius v1.*, Tavily, OpenAI/Anthropic sk-, Google AIza, GitHub gh*_,
// AWS AKIA, PEM private keys, ngrok authtokens) run everywhere, including big generated data. The generic
// "*_KEY/_TOKEN/_SECRET/PASSWORD=<real value>" rule only runs on .env* files, and any tracked .env /
// .env.* file other than *.env.example is itself a finding.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const stagedOnly = args.includes('--staged');
const repoIdx = args.indexOf('--repo');
const repo = resolve(repoIdx >= 0 ? (args[repoIdx + 1] ?? '') : '.');
if (args.includes('--help') || args.includes('-h') || (repoIdx >= 0 && !args[repoIdx + 1])) {
  console.log('usage: node scripts/scan-secrets.ts [--staged] [--repo <path>]');
  process.exit(repoIdx >= 0 && !args[repoIdx + 1] ? 2 : 0);
}

// Files whose own source legitimately contains the patterns.
const ALLOW_FILES = new Set(['scripts/scan-secrets.ts']);
// Big generated data / lockfiles: strong rules only.
const GENERATED = [/^apps\/web\/public\/osm\/.*\.json$/, /^apps\/server\/data\/.*\.json$/, /(^|\/)pnpm-lock\.yaml$/];

interface Rule {
  name: string;
  re: RegExp; // global; capture group 1 (if any) is the secret, else the whole match
  minClasses?: number; // require this many of [a-z], [A-Z], [0-9] in the secret (cuts prose false hits)
}
const STRONG: Rule[] = [
  { name: 'nebius-static-key', re: /\bv1\.[A-Za-z0-9_\-+/]{30,}={0,2}\.[A-Za-z0-9_\-+/]{30,}={0,2}/g, minClasses: 3 },
  { name: 'tavily-key', re: /\btvly-(?:dev-|prod-)?[A-Za-z0-9]{20,}/g, minClasses: 2 },
  { name: 'anthropic-key', re: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g, minClasses: 3 },
  { name: 'openai-key', re: /(?<![A-Za-z0-9_-])sk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, minClasses: 3 },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g, minClasses: 2 },
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'private-key-pem', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { name: 'ngrok-authtoken', re: /(?:NGROK_AUTHTOKEN|authtoken)["'\s:=]+([0-9A-Za-z]{20,}_[0-9A-Za-z]{20,})/gi, minClasses: 2 },
];
const ENV_ASSIGN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*(?:_KEY|_TOKEN|_SECRET|PASSWORD))\s*[=:]\s*(.*?)\s*$/i;
const PLACEHOLDER =
  /^(?:|["']{2}|<.*>|\$\{.*\}|\$[A-Z_]+|.*(?:your|example|placeholder|changeme|change_me|dummy|fake|redacted|xxxx|\.\.\.|replace).*|test|testing|k|key|secret|token|none|null|todo|tbd)$/i;

const isEnvFile = (p: string) => /(^|\/)\.env(\..*)?$/.test(p) || /(^|\/)[^/]*\.env$/.test(p);
const isEnvExample = (p: string) => /\.example$/.test(p) || /\.sample$/.test(p) || /\.template$/.test(p);

interface Finding {
  where: string; // 'index' or short commit sha
  file: string;
  line: number;
  rule: string;
  preview: string;
}
const findings: Finding[] = [];
const seen = new Set<string>();

function redact(s: string): string {
  return `${s.slice(0, 4)}${'*'.repeat(8)} (len ${s.length})`;
}
function classes(s: string): number {
  return (/[a-z]/.test(s) ? 1 : 0) + (/[A-Z]/.test(s) ? 1 : 0) + (/[0-9]/.test(s) ? 1 : 0);
}
function stripQuotes(v: string): string {
  const noComment = v.replace(/\s+#.*$/, '');
  return noComment.replace(/^(["'])(.*)\1$/, '$2');
}
function add(f: Finding, secret: string) {
  const key = `${f.where}|${f.file}|${f.rule}|${secret}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(f);
}

function scanLine(where: string, file: string, lineNo: number, text: string) {
  if (ALLOW_FILES.has(file)) return;
  if (text.length > 20_000) text = text.slice(0, 20_000); // minified one-liners
  for (const r of STRONG) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      const secret = m[1] ?? m[0];
      if (r.minClasses && classes(secret) < r.minClasses) continue;
      if (r.name !== 'private-key-pem' && PLACEHOLDER.test(secret.replace(/^[a-z]+-(?:dev-|prod-)?/i, ''))) continue;
      add({ where, file, line: lineNo, rule: r.name, preview: redact(secret) }, secret);
    }
  }
  if (isEnvFile(file) && !GENERATED.some((g) => g.test(file))) {
    const m = ENV_ASSIGN.exec(text);
    if (m) {
      const value = stripQuotes(m[2]);
      if (!PLACEHOLDER.test(value)) {
        add({ where, file, line: lineNo, rule: `env-assignment(${m[1]})`, preview: redact(value) }, `${m[1]}=${value}`);
      }
    }
  }
}

function checkTrackedEnvName(where: string, file: string) {
  if (isEnvFile(file) && !isEnvExample(file)) {
    add({ where, file, line: 0, rule: 'tracked-env-file', preview: '(file should be gitignored)' }, file);
  }
}

function git(argv: string[], input?: string): Buffer {
  return execFileSync('git', ['-C', repo, ...argv], { input, maxBuffer: 1 << 30 });
}

// ---- (a) index: every tracked file's staged blob ----
function scanIndex() {
  const files = git(['ls-files', '-z', '--cached']).toString('utf8').split('\0').filter(Boolean);
  if (!files.length) return;
  for (const f of files) checkTrackedEnvName('index', f);
  // One cat-file process for all blobs. Request by ":<path>" (stage-0 index entry).
  const out = git(['cat-file', '--batch'], files.map((f) => `:${f}`).join('\n') + '\n');
  let pos = 0;
  for (const file of files) {
    const nl = out.indexOf(10, pos);
    const header = out.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    if (header.endsWith(' missing')) continue; // e.g. unmerged or submodule
    const size = Number(header.split(' ')[2]);
    const blob = out.subarray(pos, pos + size);
    pos += size + 1; // trailing LF
    if (header.split(' ')[1] !== 'blob') continue;
    if (blob.subarray(0, 8000).includes(0)) continue; // binary
    const lines = blob.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) scanLine('index', file, i + 1, lines[i]);
  }
}

// ---- (b) history: every added line in every commit on every ref ----
function scanHistory() {
  let log: string;
  try {
    log = git(['log', '--all', '-p', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--format=@@COMMIT %H']).toString('utf8');
  } catch {
    return; // empty repo (no commits yet)
  }
  let commit = '';
  let file = '';
  let lineNo = 0;
  for (const raw of log.split('\n')) {
    if (raw.startsWith('@@COMMIT ')) {
      commit = raw.slice(9, 17);
      file = '';
    } else if (raw.startsWith('diff --git ')) {
      file = '';
    } else if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? '' : raw.slice(4).replace(/^b\//, '').replace(/^"b\/(.*)"$/, '$1');
      if (file) checkTrackedEnvName(commit, file);
    } else if (raw.startsWith('@@ ')) {
      const m = /\+(\d+)/.exec(raw);
      lineNo = m ? Number(m[1]) : 0;
    } else if (raw.startsWith('+') && file) {
      scanLine(commit, file, lineNo, raw.slice(1));
      lineNo++;
    }
  }
}

const t0 = performance.now();
try {
  git(['rev-parse', '--git-dir']);
} catch {
  console.error(`scan-secrets: ${repo} is not a git repository`);
  process.exit(2);
}
scanIndex();
if (!stagedOnly) scanHistory();
const ms = Math.round(performance.now() - t0);

const scope = stagedOnly ? 'index' : 'index + full history';
if (!findings.length) {
  console.log(`scan-secrets: clean (${scope}, ${ms} ms)`);
  process.exit(0);
}
console.error(`scan-secrets: ${findings.length} possible secret(s) found (${scope}, ${ms} ms)\n`);
for (const f of findings) {
  const where = f.where === 'index' ? 'index ' : `commit ${f.where}`;
  console.error(`  ${where}  ${f.file}:${f.line}  [${f.rule}]  ${f.preview}`);
}
console.error(
  '\nRotate any real key that appears above, then remove it (git rm --cached / fix the file).' +
    '\nFindings in history stay reachable until history is rewritten — rotating the key is the real fix.',
);
process.exit(1);
