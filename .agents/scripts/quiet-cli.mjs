#!/usr/bin/env node
/**
 * Quiet CLI wrapper for AI agents (Trick #2: Log Truncation & Zero-Noise Verification).
 * Replaces 500-line passing Vitest/ESLint/TSC logs (~15k tokens) with a 1-line summary (~15 tokens),
 * and caps failure output to only the actionable error lines.
 *
 * Usage:
 *   node .agents/scripts/quiet-cli.mjs tsc
 *   node .agents/scripts/quiet-cli.mjs lint [files...]
 *   node .agents/scripts/quiet-cli.mjs unit [test-files...]
 *   node .agents/scripts/quiet-cli.mjs pr-check
 */
import { spawnSync } from 'node:child_process';

const MAX_FAILURE_LINES = 35;

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
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
  const tail = lines.slice(-MAX_FAILURE_LINES);
  process.stderr.write(
    `[quiet-cli] ${label}: FAIL (exit ${res.status ?? 1}) — showing ${tail.length}/${lines.length} lines:\n${tail.join('\n')}\n`
  );
  return false;
}

function main() {
  const [mode = 'pr-check', ...rest] = process.argv.slice(2);

  if (mode === 'tsc') {
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
    const okTsc = runStep('tsc', 'npx', ['tsc', '--noEmit', '--pretty', 'false']);
    if (!okTsc) process.exit(1);
    const okLint = runStep('lint', 'npx', ['eslint', '--quiet', 'src']);
    if (!okLint) process.exit(1);
    const okUnit = runStep('unit', 'npx', ['vitest', 'run', '--reporter=dot', '--bail=1']);
    process.exit(okUnit ? 0 : 1);
  }

  process.stderr.write(`Unknown mode "${mode}". Use: tsc | lint | unit | pr-check\n`);
  process.exit(1);
}

main();
