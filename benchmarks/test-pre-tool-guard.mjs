#!/usr/bin/env node
/**
 * Regression test suite for `.agents/hooks/pre-tool-guard.mjs` + `command-rewrite.mjs`:
 * 1. Auto-rewrites raw noisy verification commands via PreToolUse `overwrite`
 * 2. Leaves already-wrapped, compound (`&&`/`|`/`>`), `--fix`, and `--watch` commands untouched
 * 3. Denies unbounded full-file reads of large source files (>24 KB) with codebase-memory-mcp guidance
 * 4. Allows bounded reads (StartLine/EndLine), small code files, and markdown files
 * 5. Preserves existing safety guards (.env, git push main, npm install)
 *
 * Usage:
 *   node benchmarks/test-pre-tool-guard.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GUARD = path.resolve(process.cwd(), '.agents/hooks/pre-tool-guard.mjs');
const TMP_REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroburn-guard-test-'));

function runGuard(toolName, args, cwd = process.cwd(), extraEnv = {}) {
  const payload = JSON.stringify({ cwd, toolCall: { name: toolName, args } });
  const res = spawnSync(process.execPath, [GUARD], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  assert.equal(res.status, 0, `Hook must exit 0, got ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

try {
  // 1. Noisy commands auto-rewritten to quiet-cli.mjs
  const rewrites = [
    ['npx vitest run src/__tests__/billing.test.ts', 'node .agents/scripts/quiet-cli.mjs unit src/__tests__/billing.test.ts'],
    ['pnpm vitest run', 'node .agents/scripts/quiet-cli.mjs unit'],
    ['npx tsc --noEmit', 'node .agents/scripts/quiet-cli.mjs tsc'],
    ['pnpm exec eslint src/lib', 'node .agents/scripts/quiet-cli.mjs lint src/lib'],
    ['pnpm pr-check', 'node .agents/scripts/quiet-cli.mjs pr-check'],
  ];
  for (const [input, expected] of rewrites) {
    const out = runGuard('run_command', { CommandLine: input });
    assert.equal(out.decision, 'allow', `Expected allow+overwrite for "${input}"`);
    assert.equal(out.overwrite?.CommandLine, expected, `Rewrite mismatch for "${input}"`);
  }

  // 2. Compound, already-wrapped, --watch, --fix, and ZEROBURN_NO_REWRITE=1 stay untouched
  const passthroughs = [
    'node .agents/scripts/quiet-cli.mjs unit',
    'npx vitest run --watch',
    'npx eslint --fix src',
    'npx tsc --noEmit && echo done',
    'npx vitest run | head -n 20',
  ];
  for (const cmd of passthroughs) {
    const out = runGuard('run_command', { CommandLine: cmd });
    assert.equal(out.decision, 'allow');
    assert.equal(out.overwrite, undefined, `Should not rewrite "${cmd}"`);
  }
  const optOut = runGuard('run_command', { CommandLine: 'npx vitest run' }, process.cwd(), {
    ZEROBURN_NO_REWRITE: '1',
  });
  assert.equal(optOut.overwrite, undefined, 'ZEROBURN_NO_REWRITE=1 should disable rewrite');

  // 3. Large unbounded read_file guard (>24 KB code file denied; bounded / small / markdown allowed)
  const bigTs = path.join(TMP_REPO, 'big.ts');
  const smallTs = path.join(TMP_REPO, 'small.ts');
  const bigMd = path.join(TMP_REPO, 'notes.md');
  fs.writeFileSync(bigTs, `${'export const x = 1;\n'.repeat(1600)}`, 'utf8'); // ~32 KB
  fs.writeFileSync(smallTs, 'export const y = 2;\n', 'utf8');
  fs.writeFileSync(bigMd, `${'# Heading\nSome documentation line.\n'.repeat(1200)}`, 'utf8'); // ~38 KB

  const denyBig = runGuard('read_file', { Path: bigTs }, TMP_REPO);
  assert.equal(denyBig.decision, 'deny', 'Expected unbounded >24KB .ts read to be denied');
  assert.match(denyBig.reason, /Context-Guard/);
  assert.match(denyBig.reason, /codebase-memory-mcp/);

  const allowBounded = runGuard('read_file', { Path: bigTs, StartLine: 1, EndLine: 80 }, TMP_REPO);
  assert.equal(allowBounded.decision, 'allow', 'Bounded read_file should be allowed');

  const allowSmall = runGuard('read_file', { Path: smallTs }, TMP_REPO);
  assert.equal(allowSmall.decision, 'allow', 'Small .ts file should be allowed');

  const allowMd = runGuard('read_file', { Path: bigMd }, TMP_REPO);
  assert.equal(allowMd.decision, 'allow', 'Markdown files should not be blocked by code read guard');

  // 4. Existing safety guards still intact
  const denyEnv = runGuard('write_file', { Path: path.join(TMP_REPO, '.env'), Content: 'SECRET=1' }, TMP_REPO);
  assert.equal(denyEnv.decision, 'deny');
  const denyPush = runGuard('run_command', { CommandLine: 'git push origin main' });
  assert.equal(denyPush.decision, 'deny');
  const denyNpm = runGuard('run_command', { CommandLine: 'npm install lodash' });
  assert.equal(denyNpm.decision, 'deny');

  console.log('✅ All pre-tool-guard tests PASSED (auto-rewrite, passthroughs, large read guard, safety guards)');
} finally {
  fs.rmSync(TMP_REPO, { recursive: true, force: true });
}
