#!/usr/bin/env node
/**
 * Quiet CLI wrapper for AI agents (Trick #2 + Pattern #2 Judgment Kernel + Pattern #5 API Map).
 * - Replaces 500-line passing Vitest/ESLint/TSC logs (~15k tokens) with a 1-line receipt (~15 tokens).
 * - On failure (>12 lines), queries local Ollama (`gemma4:latest` Judgment Kernel) in 0 cloud tokens
 *   to emit a 3-line root-cause digest above the capped error tail.
 * - `api-map` mode introspects Next.js App Router `/api/**` routes & rate-limit coverage in 0 tokens.
 *
 * Usage:
 *   node .agents/scripts/quiet-cli.mjs tsc
 *   node .agents/scripts/quiet-cli.mjs lint [files...]
 *   node .agents/scripts/quiet-cli.mjs unit [test-files...]
 *   node .agents/scripts/quiet-cli.mjs pr-check
 *   node .agents/scripts/quiet-cli.mjs api-map
 *   node .agents/scripts/quiet-cli.mjs docs-parity
 *   node .agents/scripts/quiet-cli.mjs exec [--query "<terms>"] <cmd> [args...]
 *   node .agents/scripts/quiet-cli.mjs search "<terms>" [--source <id>] [--limit <n>]
 *   node .agents/scripts/quiet-cli.mjs stats [--json] [--reset]
 *   node .agents/scripts/quiet-cli.mjs purge
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';
import {
  formatStats,
  indexOutput,
  purgeStore,
  readStats,
  recordSavings,
  resetStats,
  searchOutputs,
} from './quiet-store.mjs';

const require = createRequire(import.meta.url);

const MAX_FAILURE_LINES = 35;
const MAX_RING_LINES = 200;
const SPILLOVER_INDEX_MIN_BYTES = 4096;
const SPILLOVER_INDEX_MAX_BYTES = 5 * 1024 * 1024;

function loadProjectConfig() {
  for (const rel of ['.agents/project.config.json', '.agents/project.config.example.json']) {
    const p = path.resolve(process.cwd(), rel);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(p)) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        // fallback
      }
    }
  }
  return {};
}

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

const PROSE_PATTERNS = ['gemma4', 'gemma3', 'gemma2', 'llama3', 'mistral', 'qwen3', 'qwen2.5', 'phi4', 'phi3'];

function resolveProseModel(ollamaUrl, configured) {
  if (configured && configured.toLowerCase() !== 'auto') return configured;
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const res = spawnSync('curl', ['-sf', '--max-time', '1', `${ollamaUrl}/api/tags`], {
      encoding: 'utf8',
      timeout: 1500,
    });
    if (res.status === 0 && res.stdout) {
      const models = (JSON.parse(res.stdout).models || []).map((m) => m.name).filter(Boolean);
      for (const pat of PROSE_PATTERNS) {
        const hit = models.find((m) => m.toLowerCase().includes(pat));
        if (hit) return hit;
      }
      if (models[0]) return models[0];
    }
  } catch {
    // fallback
  }
  return 'gemma4:latest';
}

function summarizeFailureWithJudgmentKernel(label, errorLines) {
  if (errorLines.length <= 12) return null;
  const cfg = loadProjectConfig();
  const ollamaUrl = (cfg.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = resolveProseModel(ollamaUrl, cfg.localProseModel || 'auto');
  const payload = JSON.stringify({
    model,
    stream: false,
    messages: [
      {
        role: 'user',
        content: `You are a concise coding-agent Judgment Kernel. Summarize this ${label} failure in at most 3 bullet lines (1. exact file:line, 2. root cause, 3. exact fix):\n\n${errorLines.slice(-60).join('\n')}`,
      },
    ],
  });
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const res = spawnSync(
      'curl',
      ['-sf', '--max-time', '12', '-H', 'Content-Type: application/json', '-d', payload, `${ollamaUrl}/api/chat`],
      { encoding: 'utf8', timeout: 13000 }
    );
    if (res.status !== 0 || !res.stdout) return null;
    const parsed = JSON.parse(res.stdout);
    const content = parsed?.message?.content?.trim();
    return content ? `[quiet-cli:judgment-kernel (${model})]\n${content}\n---` : null;
  } catch {
    return null;
  }
}

function createLogArtifactPath(label) {
  const safeLabel = String(label || 'cmd').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = process.env.ZEROBURN_QUIET_LOG_DIR || os.tmpdir();
  return path.join(dir, `zeroburn-quiet-cli-${safeLabel}-${process.pid}-${Date.now()}.log`);
}

function isNoiseLine(line) {
  return !line || line.startsWith('RUN  v') || line.includes('transform ') || line.includes('[queued]');
}

async function indexLogFileIfEligible(logPath, { label, command, exitCode, totalBytes, force = false }) {
  if (!force && totalBytes < SPILLOVER_INDEX_MIN_BYTES) return null;
  if (totalBytes > SPILLOVER_INDEX_MAX_BYTES) return null;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(logPath)) return null;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const rawText = stripAnsi(fs.readFileSync(logPath, 'utf8'));
    const indexed = await indexOutput({ label, command, text: rawText, exitCode });
    return indexed.chunkCount > 0 ? indexed : null;
  } catch {
    return null;
  }
}

async function runStep(label, cmd, args, opts = {}) {
  const query = typeof opts.query === 'string' && opts.query.trim() ? opts.query.trim() : null;
  const commandStr = [cmd, ...args].join(' ');
  const logPath = createLogArtifactPath(label);
  const stdoutRing = [];
  const stderrRing = [];
  const summaryMatches = [];
  let totalLines = 0;
  let totalBytes = 0;
  let stdoutCarry = '';
  let stderrCarry = '';
  let logStream = null;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    logStream = fs.createWriteStream(logPath, { encoding: 'utf8' });
  } catch {
    logStream = null;
  }

  const pushLine = (ring, cleaned) => {
    if (isNoiseLine(cleaned)) return;
    totalLines += 1;
    ring.push(cleaned);
    if (ring.length > MAX_RING_LINES) ring.shift();
    const m = cleaned.match(/Test Files\s+\d+\s+passed.*|Tests\s+\d+\s+passed.*/g);
    if (m) summaryMatches.push(...m);
  };

  const makeIngest = (ring, getCarry, setCarry) => (chunk) => {
    const raw = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    totalBytes += Buffer.byteLength(raw, 'utf8');
    if (logStream) logStream.write(raw);

    const text = stripAnsi(getCarry() + raw);
    const parts = text.split(/\r?\n/);
    setCarry(parts.pop() || '');
    for (const part of parts) pushLine(ring, part.trimEnd());
  };

  const ingestStdout = makeIngest(
    stdoutRing,
    () => stdoutCarry,
    (v) => {
      stdoutCarry = v;
    }
  );
  const ingestStderr = makeIngest(
    stderrRing,
    () => stderrCarry,
    (v) => {
      stderrCarry = v;
    }
  );

  const flushCarries = () => {
    if (stdoutCarry) {
      pushLine(stdoutRing, stripAnsi(stdoutCarry).trimEnd());
      stdoutCarry = '';
    }
    if (stderrCarry) {
      pushLine(stderrRing, stripAnsi(stderrCarry).trimEnd());
      stderrCarry = '';
    }
  };

  const closeLogStream = () =>
    new Promise((resolve) => {
      if (!logStream) return resolve();
      logStream.end(() => resolve());
    });

  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
      });
    } catch (error) {
      finish({ code: null, signal: null, error });
      return;
    }

    child.stdout?.on('data', ingestStdout);
    child.stderr?.on('data', ingestStderr);
    child.on('error', (error) => finish({ code: null, signal: null, error }));
    child.on('close', (code, signal) => finish({ code, signal, error: null }));
  });

  flushCarries();
  await closeLogStream();

  // Combine stdout tail + stderr tail so stderr diagnostics are never drowned out by buffered stdout
  const combinedRing = [...stdoutRing, ...stderrRing];

  if (outcome.error) {
    const errCode = outcome.error.code || 'SPAWN_ERROR';
    process.stderr.write(
      `[quiet-cli] ${label}: ERROR (${errCode}) — failed to execute \`${cmd}\`: ${outcome.error.message}\n`
    );
    return false;
  }

  if (outcome.signal) {
    const tail = combinedRing.slice(-MAX_FAILURE_LINES);
    const out =
      `[quiet-cli] ${label}: KILLED (signal ${outcome.signal}) — captured ${totalLines} lines (${totalBytes} bytes); full log: ${logPath}\n` +
      (tail.length > 0 ? `${tail.join('\n')}\n` : '');
    process.stderr.write(out);
    recordSavings({ label, rawBytes: totalBytes, emittedBytes: Buffer.byteLength(out, 'utf8') });
    return false;
  }

  if (outcome.code === 0) {
    if (query) {
      const indexed = await indexLogFileIfEligible(logPath, {
        label,
        command: commandStr,
        exitCode: 0,
        totalBytes,
        force: true,
      });
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
      } catch {
        // best-effort cleanup
      }
      if (indexed) {
        const res = await searchOutputs(query, { sourceId: indexed.sourceId, limit: opts.limit || 5 });
        const header = `[quiet-cli] ${label}: PASS (${indexed.sourceId}, ${indexed.chunkCount} chunks via ${indexed.engine}; ${res.hits.length} hit(s) for "${query}")`;
        const body =
          res.hits.length > 0
            ? res.hits.map((h) => `--- [${h.sourceId}#${h.chunkIdx}] ---\n${h.snippet}`).join('\n')
            : `(no direct match — search with: node .agents/scripts/quiet-cli.mjs search "<terms>" --source ${indexed.sourceId})`;
        const out = `${header}\n${body}\n`;
        process.stdout.write(out);
        recordSavings({
          label,
          rawBytes: totalBytes,
          emittedBytes: Buffer.byteLength(out, 'utf8'),
          engine: indexed.engine,
        });
        return true;
      }
    }

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    } catch {
      // best-effort cleanup on green runs
    }
    const extra =
      summaryMatches.length > 0 ? ` (${summaryMatches.slice(-2).join(', ').replace(/\s+/g, ' ')})` : '';
    const out = `[quiet-cli] ${label}: PASS${extra}\n`;
    process.stdout.write(out);
    recordSavings({ label, rawBytes: totalBytes, emittedBytes: Buffer.byteLength(out, 'utf8') });
    return true;
  }

  const indexed = await indexLogFileIfEligible(logPath, {
    label,
    command: commandStr,
    exitCode: outcome.code ?? 1,
    totalBytes,
  });
  const kernelDigest =
    process.env.ZEROBURN_DISABLE_JUDGMENT_KERNEL === '1'
      ? null
      : summarizeFailureWithJudgmentKernel(label, combinedRing);
  const tail = combinedRing.slice(-MAX_FAILURE_LINES);
  const indexHint = indexed
    ? `[quiet-cli] indexed ${indexed.chunkCount} chunks (${indexed.engine}) as ${indexed.sourceId} — search: node .agents/scripts/quiet-cli.mjs search "<terms>" --source ${indexed.sourceId}\n`
    : '';
  const out =
    `[quiet-cli] ${label}: FAIL (exit ${outcome.code ?? 1}) — showing ${tail.length}/${totalLines} lines (full log: ${logPath}):\n` +
    (kernelDigest ? `${kernelDigest}\n` : '') +
    `${tail.join('\n')}\n` +
    indexHint;
  process.stderr.write(out);
  recordSavings({
    label,
    rawBytes: totalBytes,
    emittedBytes: Buffer.byteLength(out, 'utf8'),
    engine: indexed?.engine || 'quiet-cli',
  });
  return false;
}

function printApiMap() {
  const apiRoot = path.resolve(process.cwd(), 'src/app/api');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(apiRoot)) {
    process.stdout.write('[quiet-cli] api-map: No src/app/api directory found.\n');
    return;
  }
  const routes = [];
  function walk(dir) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const src = fs.readFileSync(full, 'utf8');
        const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map(
          (m) => m[1]
        );
        const relFile = path.relative(process.cwd(), full).replace(/\\/g, '/');
        const endpoint = '/' + relFile.replace(/^src\/app\//, '').replace(/\/route\.[tj]s$/, '');
        routes.push(`${(methods.join(',') || 'HANDLER').padEnd(10)} ${endpoint} -> ${relFile}`);
      }
    }
  }
  walk(apiRoot);
  routes.sort();
  process.stdout.write(`[quiet-cli] api-map (${routes.length} routes):\n${routes.join('\n')}\n`);
}

function checkDeclaredDependencies() {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(pkgPath)) return true;

  let ts;
  try {
    ts = require('typescript');
  } catch {
    return true;
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
  const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

  const files = [];
  function walk(dir) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.next') || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) files.push(full);
    }
  }

  const srcRoot = path.resolve(process.cwd(), 'src');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (fs.existsSync(srcRoot)) walk(srcRoot);
  for (const topFile of ['playwright.config.ts', 'next.config.ts']) {
    const full = path.resolve(process.cwd(), topFile);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(full)) files.push(full);
  }

  const violations = [];
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const txt = fs.readFileSync(file, 'utf8');
    const info = ts.preProcessFile(txt, true, true);
    for (const imp of info.importedFiles) {
      const spec = imp.fileName;
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue;
      const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!builtins.has(pkgName) && !builtins.has(spec) && !declared.has(pkgName)) {
        const line = txt.slice(0, imp.pos).split('\n').length;
        const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
        violations.push(`${rel}:${line} -> undeclared package "${pkgName}" (from "${spec}")`);
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `[quiet-cli] deps: FAIL (${violations.length} undeclared import(s) missing from package.json):\n` +
        `${violations.slice(0, MAX_FAILURE_LINES).join('\n')}\n`
    );
    return false;
  }

  process.stdout.write(`[quiet-cli] deps: PASS\n`);
  return true;
}

function checkDocsParity() {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const baseCheck = spawnSync('git', ['rev-parse', '--verify', 'origin/main'], { encoding: 'utf8' });
  const baseRef = baseCheck.status === 0 ? 'origin/main' : 'HEAD~1';
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const diffRes = spawnSync('git', ['diff', '--name-only', baseRef], { encoding: 'utf8' });
  const changed = (diffRes.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const userOrArchChanged = changed.filter(
    (f) =>
      (/^(src\/app\/|src\/lib\/billing\/|src\/lib\/ratelimit\/|src\/lib\/platforms\/|prisma\/schema\.prisma)/.test(f) &&
        !f.includes('__tests__') &&
        !f.startsWith('src/lib/ai/docs-knowledge/'))
  );
  const docsChanged = changed.filter((f) => f.startsWith('docs/') || f === 'README.md');
  const knowledgeChanged = changed.filter((f) => f.startsWith('src/lib/ai/docs-knowledge/'));

  if (userOrArchChanged.length === 0) {
    process.stdout.write('[quiet-cli] docs-parity: PASS (no user-facing/schema changes)\n');
    return true;
  }
  if (docsChanged.length === 0 && knowledgeChanged.length === 0) {
    process.stdout.write(
      `[quiet-cli] docs-parity: WARN (${userOrArchChanged.length} app/schema file(s) changed, 0 docs/ or src/lib/ai/docs-knowledge/ updates)\n`
    );
    return false;
  }
  process.stdout.write(
    `[quiet-cli] docs-parity: PASS (app=${userOrArchChanged.length}, docs=${docsChanged.length}, knowledge=${knowledgeChanged.length})\n`
  );
  return true;
}

async function main() {
  const [mode = 'pr-check', ...rest] = process.argv.slice(2);

  if (mode === 'api-map') {
    printApiMap();
    process.exit(0);
  }

  if (mode === 'docs-parity') {
    checkDocsParity();
    process.exit(0);
  }

  if (mode === 'search') {
    let sourceId = null;
    let limit = 5;
    const queryParts = [];
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '--source' && rest[i + 1]) {
        sourceId = rest[i + 1];
        i += 1;
      } else if (rest[i] === '--limit' && rest[i + 1]) {
        limit = Number(rest[i + 1]) || 5;
        i += 1;
      } else {
        queryParts.push(rest[i]);
      }
    }
    const query = queryParts.join(' ').trim();
    if (!query) {
      process.stderr.write('Usage: node .agents/scripts/quiet-cli.mjs search "<terms>" [--source <id>] [--limit <n>]\n');
      process.exit(1);
    }
    const res = await searchOutputs(query, { sourceId, limit });
    if (res.hits.length === 0) {
      process.stdout.write(`[quiet-cli] search (${res.engine}): 0 hits for "${query}"\n`);
      process.exit(0);
    }
    const lines = [
      `[quiet-cli] search (${res.engine}): ${res.hits.length} hit(s) for "${query}"`,
      ...res.hits.map((h) => `--- [${h.sourceId}#${h.chunkIdx} ${h.label}] ---\n${h.snippet}`),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exit(0);
  }

  if (mode === 'stats') {
    if (rest.includes('--reset')) {
      resetStats();
      process.stdout.write('[quiet-cli] stats: reset.\n');
      process.exit(0);
    }
    const stats = readStats();
    if (rest.includes('--json')) {
      process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    } else {
      process.stdout.write(formatStats(stats));
    }
    process.exit(0);
  }

  if (mode === 'purge') {
    purgeStore();
    process.stdout.write('[quiet-cli] purge: cleared local spillover index and savings ledger.\n');
    process.exit(0);
  }

  if (mode === 'exec') {
    let query = null;
    let limit = 5;
    const positional = [];
    for (let i = 0; i < rest.length; i += 1) {
      if (positional.length === 0 && (rest[i] === '--query' || rest[i] === '--intent') && rest[i + 1]) {
        query = rest[i + 1];
        i += 1;
      } else if (positional.length === 0 && rest[i] === '--limit' && rest[i + 1]) {
        limit = Number(rest[i + 1]) || 5;
        i += 1;
      } else if (positional.length === 0 && rest[i] === '--') {
        positional.push(...rest.slice(i + 1));
        break;
      } else {
        positional.push(rest[i]);
      }
    }
    const [cmd, ...cmdArgs] = positional;
    if (!cmd) {
      process.stderr.write('Usage: node .agents/scripts/quiet-cli.mjs exec [--query "<terms>"] <cmd> [args...]\n');
      process.exit(1);
    }
    const ok = await runStep(path.basename(cmd), cmd, cmdArgs, { query, limit });
    process.exit(ok ? 0 : 1);
  }

  if (mode === 'tsc') {
    const okDeps = checkDeclaredDependencies();
    if (!okDeps) process.exit(1);
    const ok = await runStep('tsc', 'npx', ['tsc', '--noEmit', '--pretty', 'false', ...rest]);
    process.exit(ok ? 0 : 1);
  }

  if (mode === 'lint') {
    const args = rest.length > 0 ? ['eslint', '--quiet', ...rest] : ['eslint', '--quiet', 'src'];
    const ok = await runStep('lint', 'npx', args);
    process.exit(ok ? 0 : 1);
  }

  if (mode === 'unit') {
    const ok = await runStep('unit', 'npx', ['vitest', 'run', '--reporter=dot', '--bail=1', ...rest]);
    process.exit(ok ? 0 : 1);
  }

  if (mode === 'pr-check') {
    checkDocsParity();
    const okDeps = checkDeclaredDependencies();
    if (!okDeps) process.exit(1);
    const okTsc = await runStep('tsc', 'npx', ['tsc', '--noEmit', '--pretty', 'false']);
    if (!okTsc) process.exit(1);
    const okLint = await runStep('lint', 'npx', ['eslint', '--quiet', 'src']);
    if (!okLint) process.exit(1);
    const okUnit = await runStep('unit', 'npx', ['vitest', 'run', '--reporter=dot', '--bail=1']);
    process.exit(okUnit ? 0 : 1);
  }

  process.stderr.write(
    `Unknown mode "${mode}". Use: tsc | lint | unit | pr-check | api-map | docs-parity | exec | search | stats | purge\n`
  );
  process.exit(1);
}

main();
