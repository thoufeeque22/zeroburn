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

  // 5. FTS5 spillover indexing & --query snippet retrieval (>95% byte reduction on 100 KB log)
  const bigLogCode = `
    for (let i = 0; i < 1200; i++) {
      process.stdout.write('INFO 2026-11-25T10:00:00Z worker=ok seq=' + i + ' payload=' + 'a'.repeat(50) + '\\n');
    }
    process.stdout.write('ERROR 2026-11-25T10:00:05Z StripeWebhookSignatureMismatch invoice_id=inv_99123 status=401\\n');
    for (let i = 0; i < 600; i++) {
      process.stdout.write('INFO 2026-11-25T10:00:10Z heartbeat=ok seq=' + i + ' payload=' + 'b'.repeat(50) + '\\n');
    }
  `;
  const queryRes = spawnSync(
    process.execPath,
    [QUIET_CLI, 'exec', '--query', 'StripeWebhookSignatureMismatch inv_99123', process.execPath, '-e', bigLogCode],
    { encoding: 'utf8', env: BASE_ENV }
  );
  assert.equal(queryRes.status, 0, `Expected exit 0 for --query exec, got ${queryRes.status}: ${queryRes.stderr}`);
  assert.match(queryRes.stdout, /\[quiet-cli\] node: PASS \(s[a-z0-9-]+, \d+ chunks via (sqlite-fts5|jsonl-fallback); [1-9]\d* hit\(s\)/);
  assert.match(queryRes.stdout, /StripeWebhookSignatureMismatch invoice_id=inv_99123/);
  assert.ok(queryRes.stdout.length < 3000, `Expected compact snippet output (<3KB), got ${queryRes.stdout.length} chars`);

  // 6. Search across indexed outputs (including punctuation/paths from failing test #2)
  const searchRes = spawnSync(
    process.execPath,
    [QUIET_CLI, 'search', 'src/billing.test.ts:42 403'],
    { encoding: 'utf8', env: BASE_ENV }
  );
  assert.equal(searchRes.status, 0, `Expected exit 0 for search, got ${searchRes.status}: ${searchRes.stderr}`);
  assert.match(searchRes.stdout, /AssertionError: expected 403 to be 200 at src\/billing\.test\.ts:42/);

  // 7. Live session savings telemetry (stats --json + formatted + --reset)
  const statsJsonRes = spawnSync(process.execPath, [QUIET_CLI, 'stats', '--json'], {
    encoding: 'utf8',
    env: BASE_ENV,
  });
  assert.equal(statsJsonRes.status, 0);
  const stats = JSON.parse(statsJsonRes.stdout);
  assert.ok(stats.calls >= 4, `Expected >=4 recorded runs, got ${stats.calls}`);
  assert.ok(stats.rawBytes > 3_000_000, `Expected >3MB rawBytes tracked, got ${stats.rawBytes}`);
  assert.ok(stats.savedPct > 98, `Expected >98% savedPct, got ${stats.savedPct}`);

  const statsTextRes = spawnSync(process.execPath, [QUIET_CLI, 'stats'], {
    encoding: 'utf8',
    env: BASE_ENV,
  });
  assert.equal(statsTextRes.status, 0);
  assert.match(statsTextRes.stdout, /\[quiet-cli\] stats \(\d+ runs\): .+ saved, ~.+ tokens kept out/);

  // 8. Purge clears index and stats cleanly
  const purgeRes = spawnSync(process.execPath, [QUIET_CLI, 'purge'], {
    encoding: 'utf8',
    env: BASE_ENV,
  });
  assert.equal(purgeRes.status, 0);
  const afterPurge = JSON.parse(
    spawnSync(process.execPath, [QUIET_CLI, 'stats', '--json'], { encoding: 'utf8', env: BASE_ENV }).stdout
  );
  assert.equal(afterPurge.calls, 0, 'Expected 0 calls after purge');

  console.log(
    '✅ All 8 quiet-cli tests PASSED (>1.5 MiB pass/fail, ENOENT, SIGKILL, FTS5 --query, search, stats, purge)'
  );
} finally {
  fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true });
}
