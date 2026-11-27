#!/usr/bin/env node
/**
 * Exact Antigravity Transcript Token & Cost Benchmark CLI.
 * Parses `transcript.jsonl` files recursively across root conversations and
 * spawned subagents (`invoke_subagent`, `run_workflow`) to compute exact
 * uncached input, cached input, output tokens, wall-clock duration, and
 * model-weighted estimated USD costs.
 *
 * Usage:
 *   node .agents/scripts/token-benchmark.mjs analyze <conv-id> [--brain-dir <dir>] [--json]
 *   node .agents/scripts/token-benchmark.mjs compare <zeroburn-conv-id> <baseline-conv-id> [--label "<title>"] [--brain-dir <dir>] [--out <markdown-path>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Estimated USD per 1M tokens. Cached input is billed at 10% of uncached input.
const PRICING_RULES = [
  { match: (m) => m.includes('ollama') || m.includes('local') || m.includes('qwen') || m.includes('gemma'), inputPer1M: 0, outputPer1M: 0 },
  { match: (m) => m.includes('flash-lite') || m.includes('flash_lite'), inputPer1M: 0.075, outputPer1M: 0.30 },
  { match: (m) => m.includes('flash'), inputPer1M: 0.15, outputPer1M: 0.60 },
  { match: (m) => m.includes('neon') || m.includes('medium'), inputPer1M: 0.60, outputPer1M: 2.50 },
  { match: (m) => m.includes('pro'), inputPer1M: 1.25, outputPer1M: 10.00 },
];

const DEFAULT_PRICING = { inputPer1M: 1.25, outputPer1M: 10.00 };

function getModelRates(modelName) {
  const normalized = String(modelName || 'unknown').toLowerCase();
  for (const rule of PRICING_RULES) {
    if (rule.match(normalized)) {
      return { inputPer1M: rule.inputPer1M, outputPer1M: rule.outputPer1M };
    }
  }
  return DEFAULT_PRICING;
}

export function estimateCostUsd(model, uncachedInput, cachedInput, output) {
  const { inputPer1M, outputPer1M } = getModelRates(model);
  const cachedInputPer1M = inputPer1M * 0.1;
  return (
    (uncachedInput / 1_000_000) * inputPer1M +
    (cachedInput / 1_000_000) * cachedInputPer1M +
    (output / 1_000_000) * outputPer1M
  );
}

function getTranscriptPath(brainDir, convId) {
  return path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
}

function extractChildConversationIds(entry, brainDir, selfId) {
  const candidates = new Set();
  const toolCallsStr = entry.tool_calls ? JSON.stringify(entry.tool_calls) : '';
  const contentStr = typeof entry.content === 'string' ? entry.content : entry.content ? JSON.stringify(entry.content) : '';
  const combined = `${toolCallsStr}\n${contentStr}`;

  const hasSubagentMarker =
    combined.includes('invoke_subagent') ||
    combined.includes('run_workflow') ||
    combined.includes('conversationId');

  if (!hasSubagentMarker) return [];

  const matches = combined.match(UUID_REGEX) || [];
  for (const rawId of matches) {
    const id = rawId.toLowerCase();
    if (id === selfId.toLowerCase()) continue;
    const childPath = getTranscriptPath(brainDir, id);
    if (fs.existsSync(childPath)) {
      candidates.add(id);
    }
  }
  return Array.from(candidates);
}

function parseSingleTranscript(brainDir, convId, roleLabel = 'root') {
  const transcriptPath = getTranscriptPath(brainDir, convId);
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript not found: ${transcriptPath}`);
  }

  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split('\n');

  let modelSteps = 0;
  let uncachedInput = 0;
  let cachedInput = 0;
  let output = 0;
  let minTs = null;
  let maxTs = null;
  const byModel = new Map();
  const discoveredChildren = new Set();

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.created_at) {
      const ts = Date.parse(entry.created_at);
      if (!Number.isNaN(ts)) {
        if (minTs === null || ts < minTs) minTs = ts;
        if (maxTs === null || ts > maxTs) maxTs = ts;
      }
    }

    if (entry.source === 'MODEL') {
      const uIn = Number(entry.input_tokens || 0);
      const cIn = Number(entry.cache_read_tokens || 0);
      const out = Number(entry.output_tokens || 0);
      const model = entry.model || 'unknown';

      if (uIn > 0 || cIn > 0 || out > 0 || entry.type === 'PLANNER_RESPONSE') {
        modelSteps += 1;
        uncachedInput += uIn;
        cachedInput += cIn;
        output += out;

        const bucket = byModel.get(model) || {
          model,
          steps: 0,
          uncachedInput: 0,
          cachedInput: 0,
          output: 0,
          estCostUsd: 0,
        };
        bucket.steps += 1;
        bucket.uncachedInput += uIn;
        bucket.cachedInput += cIn;
        bucket.output += out;
        bucket.estCostUsd += estimateCostUsd(model, uIn, cIn, out);
        byModel.set(model, bucket);
      }
    }

    for (const childId of extractChildConversationIds(entry, brainDir, convId)) {
      discoveredChildren.add(childId);
    }
  }

  const estCostUsd = Array.from(byModel.values()).reduce((sum, b) => sum + b.estCostUsd, 0);

  return {
    convId,
    role: roleLabel,
    transcriptPath,
    modelSteps,
    uncachedInput,
    cachedInput,
    totalInput: uncachedInput + cachedInput,
    output,
    totalTokens: uncachedInput + cachedInput + output,
    estCostUsd,
    minTs,
    maxTs,
    durationMs: minTs !== null && maxTs !== null ? Math.max(0, maxTs - minTs) : 0,
    byModel,
    children: Array.from(discoveredChildren),
  };
}

export function analyzeConversationTree(rootConvId, brainDir) {
  const visited = new Set();
  const queue = [{ id: rootConvId, role: 'root' }];
  const agents = [];
  const totalByModel = new Map();

  let minTs = null;
  let maxTs = null;

  while (queue.length > 0) {
    const { id, role } = queue.shift();
    const normId = id.toLowerCase();
    if (visited.has(normId)) continue;
    visited.add(normId);

    const parsed = parseSingleTranscript(brainDir, id, role);
    agents.push({
      convId: parsed.convId,
      role: parsed.role,
      modelSteps: parsed.modelSteps,
      uncachedInput: parsed.uncachedInput,
      cachedInput: parsed.cachedInput,
      totalInput: parsed.totalInput,
      output: parsed.output,
      totalTokens: parsed.totalTokens,
      estCostUsd: parsed.estCostUsd,
      durationMs: parsed.durationMs,
      models: Array.from(parsed.byModel.keys()),
    });

    if (parsed.minTs !== null && (minTs === null || parsed.minTs < minTs)) minTs = parsed.minTs;
    if (parsed.maxTs !== null && (maxTs === null || parsed.maxTs > maxTs)) maxTs = parsed.maxTs;

    for (const [model, b] of parsed.byModel.entries()) {
      const agg = totalByModel.get(model) || {
        model,
        steps: 0,
        uncachedInput: 0,
        cachedInput: 0,
        totalInput: 0,
        output: 0,
        totalTokens: 0,
        estCostUsd: 0,
      };
      agg.steps += b.steps;
      agg.uncachedInput += b.uncachedInput;
      agg.cachedInput += b.cachedInput;
      agg.totalInput += b.uncachedInput + b.cachedInput;
      agg.output += b.output;
      agg.totalTokens += b.uncachedInput + b.cachedInput + b.output;
      agg.estCostUsd += b.estCostUsd;
      totalByModel.set(model, agg);
    }

    for (const childId of parsed.children) {
      if (!visited.has(childId.toLowerCase())) {
        queue.push({ id: childId, role: `subagent-${agents.length}` });
      }
    }
  }

  const totals = agents.reduce(
    (acc, a) => {
      acc.modelSteps += a.modelSteps;
      acc.uncachedInput += a.uncachedInput;
      acc.cachedInput += a.cachedInput;
      acc.totalInput += a.totalInput;
      acc.output += a.output;
      acc.totalTokens += a.totalTokens;
      acc.estCostUsd += a.estCostUsd;
      return acc;
    },
    { modelSteps: 0, uncachedInput: 0, cachedInput: 0, totalInput: 0, output: 0, totalTokens: 0, estCostUsd: 0 }
  );

  const cacheHitPct = totals.totalInput > 0 ? (totals.cachedInput / totals.totalInput) * 100 : 0;
  const wallClockMs = minTs !== null && maxTs !== null ? Math.max(0, maxTs - minTs) : 0;

  return {
    rootConvId,
    brainDir,
    subagentCount: Math.max(0, agents.length - 1),
    wallClockMs,
    cacheHitPct,
    ...totals,
    byModel: Array.from(totalByModel.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    agents,
  };
}

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

function fmtUsd(n) {
  return `$${(Number(n) || 0).toFixed(4)}`;
}

function fmtDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return h > 0 ? `${h}h ${remM}m ${s}s` : `${m}m ${s}s`;
}

function fmtPct(n) {
  return `${(Number(n) || 0).toFixed(1)}%`;
}

function fmtDelta(zeroburnVal, baselineVal, lowerIsBetter = true) {
  if (!baselineVal) return 'N/A';
  const diff = zeroburnVal - baselineVal;
  const pct = (diff / baselineVal) * 100;
  const sign = pct > 0 ? '+' : '';
  const tag = diff === 0 ? '' : lowerIsBetter ? (diff < 0 ? ' (better)' : ' (higher)') : (diff > 0 ? ' (higher)' : ' (lower)');
  return `${sign}${pct.toFixed(1)}%${tag}`;
}

function renderMarkdownTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function formatAnalyzeText(report) {
  const lines = [
    `=== Antigravity Transcript Token Analysis ===`,
    `Root Conversation : ${report.rootConvId}`,
    `Child Subagents   : ${report.subagentCount}`,
    `Total Model Steps : ${report.modelSteps}`,
    `Wall-Clock Time   : ${fmtDuration(report.wallClockMs)}`,
    `Uncached Input    : ${fmtNum(report.uncachedInput)}`,
    `Cached Input      : ${fmtNum(report.cachedInput)} (${fmtPct(report.cacheHitPct)} cache hit)`,
    `Total Input       : ${fmtNum(report.totalInput)}`,
    `Output Tokens     : ${fmtNum(report.output)}`,
    `Total Tokens      : ${fmtNum(report.totalTokens)}`,
    `Est. Cloud Cost*  : ${fmtUsd(report.estCostUsd)}`,
    ``,
    `Per-Model Breakdown:`,
    renderMarkdownTable(
      ['Model', 'Steps', 'Uncached Input', 'Cached Input', 'Output', 'Total Tokens', 'Est. Cost*'],
      report.byModel.map((m) => [
        m.model,
        String(m.steps),
        fmtNum(m.uncachedInput),
        fmtNum(m.cachedInput),
        fmtNum(m.output),
        fmtNum(m.totalTokens),
        fmtUsd(m.estCostUsd),
      ])
    ),
  ];

  if (report.agents.length > 1) {
    lines.push(
      ``,
      `Per-Agent Breakdown:`,
      renderMarkdownTable(
        ['Role', 'Conversation ID', 'Steps', 'Uncached Input', 'Cached Input', 'Output', 'Duration', 'Est. Cost*'],
        report.agents.map((a) => [
          a.role,
          a.convId,
          String(a.modelSteps),
          fmtNum(a.uncachedInput),
          fmtNum(a.cachedInput),
          fmtNum(a.output),
          fmtDuration(a.durationMs),
          fmtUsd(a.estCostUsd),
        ])
      )
    );
  }

  lines.push(
    ``,
    `*Note: Token counts and step timings are exact values from Antigravity transcript.jsonl logs. USD costs are estimates based on representative per-1M token rates (cached input billed at 10% of uncached input; local Ollama = $0).`
  );
  return `${lines.join('\n')}\n`;
}

function formatComparisonMarkdown(zb, base, label) {
  const title = label ? `ZeroBurn Benchmark Report: ${label}` : 'ZeroBurn vs. Unorchestrated Baseline Benchmark';
  const rows = [
    ['Uncached Input Tokens', fmtNum(zb.uncachedInput), fmtNum(base.uncachedInput), fmtDelta(zb.uncachedInput, base.uncachedInput)],
    ['Cached Input Tokens', fmtNum(zb.cachedInput), fmtNum(base.cachedInput), fmtDelta(zb.cachedInput, base.cachedInput, false)],
    ['Total Input Tokens', fmtNum(zb.totalInput), fmtNum(base.totalInput), fmtDelta(zb.totalInput, base.totalInput)],
    ['Cache Hit Rate', fmtPct(zb.cacheHitPct), fmtPct(base.cacheHitPct), fmtDelta(zb.cacheHitPct, base.cacheHitPct, false)],
    ['Output Tokens', fmtNum(zb.output), fmtNum(base.output), fmtDelta(zb.output, base.output)],
    ['Total Tokens (In + Out)', fmtNum(zb.totalTokens), fmtNum(base.totalTokens), fmtDelta(zb.totalTokens, base.totalTokens)],
    ['Model Steps (Turns)', fmtNum(zb.modelSteps), fmtNum(base.modelSteps), fmtDelta(zb.modelSteps, base.modelSteps)],
    ['Subagents Spawned', fmtNum(zb.subagentCount), fmtNum(base.subagentCount), '—'],
    ['Wall-Clock Time', fmtDuration(zb.wallClockMs), fmtDuration(base.wallClockMs), fmtDelta(zb.wallClockMs, base.wallClockMs)],
    ['Estimated Cloud Cost*', fmtUsd(zb.estCostUsd), fmtUsd(base.estCostUsd), fmtDelta(zb.estCostUsd, base.estCostUsd)],
  ];

  const zbModels = renderMarkdownTable(
    ['Model', 'Steps', 'Uncached In', 'Cached In', 'Output', 'Total', 'Est. Cost*'],
    zb.byModel.map((m) => [
      m.model,
      String(m.steps),
      fmtNum(m.uncachedInput),
      fmtNum(m.cachedInput),
      fmtNum(m.output),
      fmtNum(m.totalTokens),
      fmtUsd(m.estCostUsd),
    ])
  );

  const baseModels = renderMarkdownTable(
    ['Model', 'Steps', 'Uncached In', 'Cached In', 'Output', 'Total', 'Est. Cost*'],
    base.byModel.map((m) => [
      m.model,
      String(m.steps),
      fmtNum(m.uncachedInput),
      fmtNum(m.cachedInput),
      fmtNum(m.output),
      fmtNum(m.totalTokens),
      fmtUsd(m.estCostUsd),
    ])
  );

  const qualityTable = renderMarkdownTable(
    ['Verification Gate', 'With ZeroBurn', 'Without Orchestration (Baseline)', 'Notes'],
    [
      ['TypeScript (`tsc`)', 'PASS / FAIL', 'PASS / FAIL', '—'],
      ['Lint (`eslint`)', 'PASS / FAIL', 'PASS / FAIL', '—'],
      ['Unit / Integration Tests', 'PASS / FAIL', 'PASS / FAIL', '—'],
      ['Docs & Knowledge Parity', 'PASS / FAIL', 'PASS / FAIL', '—'],
      ['Security / Audit Findings', '0 Critical/High', '0 Critical/High', '—'],
      ['Diff Footprint (Files / LOC)', '—', '—', '—'],
    ]
  );

  return [
    `# ${title}`,
    ``,
    `- **ZeroBurn Root Conversation:** \`${zb.rootConvId}\``,
    `- **Baseline Root Conversation:** \`${base.rootConvId}\``,
    `- **Generated:** ${new Date().toISOString()}`,
    ``,
    `## Side-by-Side Token, Latency & Cost Comparison`,
    ``,
    renderMarkdownTable(['Metric', 'With ZeroBurn', 'Without Orchestration', 'Delta (ZeroBurn vs. Baseline)'], rows),
    ``,
    `## Per-Model Breakdown: With ZeroBurn`,
    ``,
    zbModels,
    ``,
    `## Per-Model Breakdown: Without Orchestration (Baseline)`,
    ``,
    baseModels,
    ``,
    `## Quality & Verification Scorecard`,
    ``,
    qualityTable,
    ``,
    `---`,
    `*Token counts, cache hits, model steps, and wall-clock timings are exact measurements extracted from Antigravity \`transcript.jsonl\` logs across the root conversation and all spawned subagent conversations. USD cost is an estimate based on representative per-1M rates (cached input at 10% of uncached input; local Ollama = $0).*`,
    ``,
  ].join('\n');
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printUsageAndExit(code = 1) {
  process.stderr.write(
    [
      'Usage:',
      '  node .agents/scripts/token-benchmark.mjs analyze <conv-id> [--brain-dir <dir>] [--json]',
      '  node .agents/scripts/token-benchmark.mjs compare <zeroburn-conv-id> <baseline-conv-id> [--label "<title>"] [--brain-dir <dir>] [--out <markdown-path>]',
      '',
    ].join('\n')
  );
  process.exit(code);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const brainDir = flags['brain-dir']
    ? path.resolve(String(flags['brain-dir']))
    : path.join(os.homedir(), '.gemini', 'antigravity', 'brain');

  if (!cmd || cmd === 'help' || flags.help) {
    printUsageAndExit(cmd ? 0 : 1);
  }

  if (cmd === 'analyze') {
    const convId = positional[1];
    if (!convId) printUsageAndExit(1);
    const report = analyzeConversationTree(convId, brainDir);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(formatAnalyzeText(report));
    }
    return;
  }

  if (cmd === 'compare') {
    const zbConvId = positional[1];
    const baseConvId = positional[2];
    if (!zbConvId || !baseConvId) printUsageAndExit(1);
    const zb = analyzeConversationTree(zbConvId, brainDir);
    const base = analyzeConversationTree(baseConvId, brainDir);
    const md = formatComparisonMarkdown(zb, base, flags.label ? String(flags.label) : '');
    if (flags.out) {
      const outPath = path.resolve(String(flags.out));
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, md, 'utf8');
      process.stdout.write(`[token-benchmark] Wrote Markdown comparison report to ${outPath}\n`);
    } else {
      process.stdout.write(md);
    }
    return;
  }

  process.stderr.write(`Unknown subcommand: ${cmd}\n`);
  printUsageAndExit(1);
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isEntrypoint) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`[token-benchmark] Error: ${err.message}\n`);
    process.exit(1);
  }
}
