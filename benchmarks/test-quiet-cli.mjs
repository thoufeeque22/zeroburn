#!/usr/bin/env node
/**
 * Regression test suite for `.agents/scripts/quiet-cli.mjs`:
 * 1. >1.5 MiB passing stdout fixture (proves no Node 1 MiB spawnSync maxBuffer kill)
 * 2. >1.5 MiB failing stdout fixture (proves bounded tail + full log artifact persisted on disk)
 * 3. Spawn error (ENOENT) distinguished from ordinary test exit failure
 * 4. Signal termination (SIGKILL) distinguished from ordinary test exit failure
 *
 * Usage:
 *   node benchmarks/test-quiet-cli.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const QUIET_CLI = path.resolve(process.cwd(), '.agents/scripts/quiet-cli.mjs');
const TEST_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroburn-quiet-cli-test-'));
const BASE_ENV = {
  ...process.env,
  ZEROBURN_QUIET_LOG_DIR: TEST_LOG_DIR,
  ZEROBURN_DISABLE_JUDGMENT_KERNEL: '1',
};

function runQuietExec(cmd, args) {
  return spawnSync(process.execPath, [QUIET_CLI, 'exec', cmd, ...args], {
    encoding: 'utf8',
    env: BASE_ENV,
  });
}

try {
  // 1. > 1.5 MiB passing output (exceeds Node's default 1 MiB spawnSync maxBuffer)
  const noisyPassCode = `
    const line = 'noisy-passing-log-line-' + 'x'.repeat(100) + '\\n';
    for (let i = 0; i < 15000; i++) process.stdout.write(line);
    process.stdout.write('Test Files  3 passed (3)\\nTests  42 passed (42)\\n');
  `;
  const passRes = runQuietExec(process.execPath, ['-e', noisyPassCode]);
  assert.equal(passRes.status, 0, `Expected exit 0 for >1.5 MiB pass, got ${passRes.status}: ${passRes.stderr}`);
  assert.match(passRes.stdout.trim(), /^\[quiet-cli\] node: PASS \(Test Files 3 passed \(3\), Tests 42 passed \(42\)\)$/);
  assert.ok(passRes.stdout.length < 200, `Expected 1-line receipt, got ${passRes.stdout.length} chars`);

  // 2. > 1.5 MiB failing output -> bounded stderr tail + full log artifact on disk
  // Use process.exitCode = 2 (instead of hard process.exit(2)) so Node flushes all 1.5 MiB stdout before exiting
  const noisyFailCode = `
    const line = 'noisy-failing-log-line-' + 'y'.repeat(100) + '\\n';
    for (let i = 0; i < 15000; i++) process.stdout.write(line);
    process.stderr.write('AssertionError: expected 403 to be 200 at src/billing.test.ts:42\\n');
    process.exitCode = 2;
  `;
  const failRes = runQuietExec(process.execPath, ['-e', noisyFailCode]);
  assert.equal(failRes.status, 1, 'Wrapper should exit 1 on child failure');
  assert.match(failRes.stderr, /\[quiet-cli\] node: FAIL \(exit 2\) — showing 35\/15001 lines \(full log: (.+\.log)\):/);
  assert.match(failRes.stderr, /AssertionError: expected 403 to be 200/);
  const logMatch = failRes.stderr.match(/full log: (.+\.log)\)/);
  assert.ok(logMatch && logMatch[1], 'Expected full log path in failure output');
  const artifactSize = fs.statSync(logMatch[1]).size;
  assert.ok(artifactSize > 1_500_000, `Expected full streamed log >1.5 MiB on disk, got ${artifactSize} bytes`);

  // 3. Spawn error (ENOENT) distinguished from ordinary test failure
  const enoentRes = runQuietExec('definitely-nonexistent-binary-zeroburn-xyz', []);
  assert.equal(enoentRes.status, 1);
  assert.match(enoentRes.stderr, /\[quiet-cli\] definitely-nonexistent-binary-zeroburn-xyz: ERROR \(ENOENT\)/);

  // 4. Signal kill (SIGKILL) distinguished from ordinary test failure
  const signalCode = `
    process.stdout.write('before-kill-diagnostic-line\\n');
    process.kill(process.pid, 'SIGKILL');
  `;
  const sigRes = runQuietExec(process.execPath, ['-e', signalCode]);
  assert.equal(sigRes.status, 1);
  assert.match(sigRes.stderr, /\[quiet-cli\] node: KILLED \(signal SIGKILL\)/);
  assert.match(sigRes.stderr, /before-kill-diagnostic-line/);

  console.log('✅ All 4 quiet-cli streaming & error-distinction tests PASSED (>1.5 MiB pass, >1.5 MiB fail + artifact, ENOENT, SIGKILL)');
} finally {
  fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true });
}
