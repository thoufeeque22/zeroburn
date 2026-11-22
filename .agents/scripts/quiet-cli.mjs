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
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const MAX_FAILURE_LINES = 35;

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

function runStep(label, cmd, args) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
  });
  const combined = stripAnsi(`${res.stdout || ''}\n${res.stderr || ''}`).trim();

  if (res.status === 0) {
    const summaryMatch = combined.match(/Test Files\s+\d+\s+passed.*|Tests\s+\d+\s+passed.*/g);
    const extra = summaryMatch ? ` (${summaryMatch.join(', ').replace(/\s+/g, ' ')})` : '';
    process.stdout.write(`[quiet-cli] ${label}: PASS${extra}\n`);
    return true;
  }

  const lines = combined
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l && !l.startsWith('RUN  v') && !l.includes('transform ') && !l.includes('[queued]'));
  const kernelDigest = summarizeFailureWithJudgmentKernel(label, lines);
  const tail = lines.slice(-MAX_FAILURE_LINES);
  process.stderr.write(
    `[quiet-cli] ${label}: FAIL (exit ${res.status ?? 1}) — showing ${tail.length}/${lines.length} lines:\n` +
      (kernelDigest ? `${kernelDigest}\n` : '') +
      `${tail.join('\n')}\n`
  );
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

  process.stdout.write('[quiet-cli] deps: PASS\n');
  return true;
}

function main() {
  const [mode = 'pr-check', ...rest] = process.argv.slice(2);

  if (mode === 'api-map') {
    printApiMap();
    process.exit(0);
  }

  if (mode === 'tsc') {
    const okDeps = checkDeclaredDependencies();
    if (!okDeps) process.exit(1);
    const ok = runStep('tsc', 'npx', ['tsc', '--noEmit', '--pretty', 'false', ...rest]);
    process.exit(ok ? 0 : 1);
  }

  if (mode === 'lint') {
    const args = rest.length > 0 ? ['eslint', '--quiet', ...rest] : ['eslint', '--quiet', 'src'];
    const ok = runStep('lint', 'npx', args);
    process.exit(ok ? 0 : 1);
  }

  if (mode === 'unit') {
    const ok = runStep('unit', 'npx', ['vitest', 'run', '--reporter=dot', '--bail=1', ...rest]);
    process.exit(ok ? 0 : 1);
  }

  if (mode === 'pr-check') {
    const okDeps = checkDeclaredDependencies();
    if (!okDeps) process.exit(1);
    const okTsc = runStep('tsc', 'npx', ['tsc', '--noEmit', '--pretty', 'false']);
    if (!okTsc) process.exit(1);
    const okLint = runStep('lint', 'npx', ['eslint', '--quiet', 'src']);
    if (!okLint) process.exit(1);
    const okUnit = runStep('unit', 'npx', ['vitest', 'run', '--reporter=dot', '--bail=1']);
    process.exit(okUnit ? 0 : 1);
  }

  process.stderr.write(`Unknown mode "${mode}". Use: tsc | lint | unit | pr-check | api-map\n`);
  process.exit(1);
}

main();
