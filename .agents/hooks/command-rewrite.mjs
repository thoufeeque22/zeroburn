/**
 * Pure PreToolUse command-rewriting & large-read context-guard helpers for ZeroBurn.
 * - Auto-rewrites raw noisy CLI commands (vitest, eslint, tsc, pnpm pr-check) into quiet-cli.mjs
 *   via Antigravity's native PreToolUse `overwrite` contract.
 * - Blocks unbounded full-file reads of large source files (>24 KB) without StartLine/EndLine,
 *   redirecting agents to codebase-memory-mcp or bounded line ranges.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_UNBOUNDED_READ_BYTES = 24576;

// Pipes, redirects, semicolons, subshells, newlines, or single background `&` stay untouched.
// Pure `&&` chains are split and rewritten segment-by-segment so chained verification
// commands (`npx tsc --noEmit && pnpm lint && npx vitest run ...`) still get quiet-cli receipts.
const UNSAFE_SHELL_RE = /[|;><`\n]|\$\(|(?<!&)&(?!&)/;
const INTERACTIVE_FLAG_RE = /(?:^|\s)(?:--watch|-w|--ui|--interactive)(?:\s|$)/;
const CODE_FILE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|rb|php|cs)$/i;

function hasQuietCli(cwd) {
  return fs.existsSync(path.join(cwd, '.agents', 'scripts', 'quiet-cli.mjs'));
}

function loadMaxUnboundedReadBytes(cwd) {
  if (process.env.ZEROBURN_MAX_UNBOUNDED_READ_BYTES !== undefined) {
    const envVal = Number(process.env.ZEROBURN_MAX_UNBOUNDED_READ_BYTES);
    if (Number.isFinite(envVal) && envVal >= 0) return envVal;
  }
  for (const rel of ['.agents/project.config.json', '.agents/project.config.example.json']) {
    const p = path.join(cwd, rel);
    if (!fs.existsSync(p)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (typeof cfg.maxUnboundedReadBytes === 'number' && cfg.maxUnboundedReadBytes >= 0) {
        return cfg.maxUnboundedReadBytes;
      }
    } catch {
      // ignore invalid config
    }
  }
  return DEFAULT_MAX_UNBOUNDED_READ_BYTES;
}

function stripRunPrefix(rest) {
  return rest.replace(/^run(?:\s+|$)/, '').trim();
}

function rewriteSingleCommand(rawSegment) {
  const cmd = String(rawSegment || '').trim();
  if (!cmd || cmd.includes('quiet-cli.mjs') || INTERACTIVE_FLAG_RE.test(cmd)) return null;

  // 1. pnpm pr-check
  if (/^pnpm(?:\s+run)?\s+pr-check$/.test(cmd)) {
    return 'node .agents/scripts/quiet-cli.mjs pr-check';
  }

  // 2. vitest run (npx / pnpm / pnpm exec)
  const vitestMatch = cmd.match(/^(?:npx|pnpm(?:\s+exec)?)\s+vitest\s+run(?:\s+(.*))?$/);
  if (vitestMatch) {
    const extra = (vitestMatch[1] || '').trim();
    return extra ? `node .agents/scripts/quiet-cli.mjs unit ${extra}` : 'node .agents/scripts/quiet-cli.mjs unit';
  }

  // 3. tsc --noEmit / pnpm typecheck
  const tscMatch = cmd.match(/^(?:npx|pnpm(?:\s+exec)?)\s+tsc\s+--noEmit(?:\s+(.*))?$/);
  if (tscMatch) {
    const extra = (tscMatch[1] || '').trim();
    return extra ? `node .agents/scripts/quiet-cli.mjs tsc ${extra}` : 'node .agents/scripts/quiet-cli.mjs tsc';
  }
  if (/^pnpm(?:\s+run)?\s+typecheck$/.test(cmd)) {
    return 'node .agents/scripts/quiet-cli.mjs tsc';
  }

  // 4. eslint / pnpm lint (skip --fix so formatting mutations aren't altered)
  const eslintMatch = cmd.match(/^(?:npx|pnpm(?:\s+exec)?)\s+eslint(?:\s+(.*))?$/);
  if (eslintMatch) {
    const extra = (eslintMatch[1] || '').trim();
    if (/(?:^|\s)--fix(?:\s|$)/.test(extra)) return null;
    const cleaned = extra.replace(/(?:^|\s)--quiet(?:\s|$)/g, ' ').trim();
    return cleaned ? `node .agents/scripts/quiet-cli.mjs lint ${cleaned}` : 'node .agents/scripts/quiet-cli.mjs lint';
  }
  const pnpmLintMatch = cmd.match(/^pnpm(?:\s+run)?\s+lint(?:\s+(?:--\s+)?(.*))?$/);
  if (pnpmLintMatch) {
    const extra = stripRunPrefix((pnpmLintMatch[1] || '').trim());
    if (/(?:^|\s)--fix(?:\s|$)/.test(extra)) return null;
    const cleaned = extra.replace(/(?:^|\s)--quiet(?:\s|$)/g, ' ').trim();
    return cleaned ? `node .agents/scripts/quiet-cli.mjs lint ${cleaned}` : 'node .agents/scripts/quiet-cli.mjs lint';
  }

  // 5. pnpm test / pnpm test:unit [args]
  const unitScriptMatch = cmd.match(/^pnpm(?:\s+run)?\s+test(?::unit)?(?:\s+(?:--\s+)?(.*))?$/);
  if (unitScriptMatch) {
    const extra = stripRunPrefix((unitScriptMatch[1] || '').trim());
    return extra ? `node .agents/scripts/quiet-cli.mjs unit ${extra}` : 'node .agents/scripts/quiet-cli.mjs unit';
  }

  return null;
}

export function rewriteNoisyCommand(rawCmd, cwd) {
  if (process.env.ZEROBURN_NO_REWRITE === '1') return null;
  const cmd = String(rawCmd || '').trim();
  if (!cmd || UNSAFE_SHELL_RE.test(cmd) || INTERACTIVE_FLAG_RE.test(cmd)) return null;
  if (!hasQuietCli(cwd)) return null;

  if (cmd.includes('&&')) {
    const segments = cmd.split(/\s*&&\s*/);
    let changed = false;
    const rewritten = segments.map((seg) => {
      const next = rewriteSingleCommand(seg);
      if (next) {
        changed = true;
        return next;
      }
      return seg.trim();
    });
    return changed ? rewritten.join(' && ') : null;
  }

  return rewriteSingleCommand(cmd);
}

export function checkLargeUnboundedRead(args, cwd) {
  const maxBytes = loadMaxUnboundedReadBytes(cwd);
  if (maxBytes <= 0) return null;

  const rawPath = typeof args.Path === 'string' ? args.Path : '';
  if (!rawPath) return null;

  const hasRange = args.StartLine !== undefined || args.EndLine !== undefined || args.ByteOffset !== undefined;
  if (hasRange) return null;

  const absTarget = path.resolve(cwd, rawPath);
  const inRepo = absTarget === cwd || absTarget.startsWith(`${cwd}${path.sep}`);
  if (!inRepo) return null;

  if (!CODE_FILE_EXT_RE.test(absTarget)) return null;
  if (!fs.existsSync(absTarget)) return null;

  let stat;
  try {
    stat = fs.statSync(absTarget);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size <= maxBytes) return null;

  const rel = path.relative(cwd, absTarget).replace(/\\/g, '/');
  const kb = (stat.size / 1024).toFixed(1);
  const capKb = (maxBytes / 1024).toFixed(0);
  return (
    `Blocked by Context-Guard: ${rel} is ${kb} KB (>${capKb} KB limit) and was requested without StartLine/EndLine. ` +
    `Use codebase-memory-mcp (get_code_snippet / search_graph) or pass StartLine & EndLine to keep context lean.`
  );
}
