/**
 * Live byte & token savings telemetry ledger for quiet-cli.mjs.
 * Appends per-run savings to os.tmpdir()/zeroburn-ctx/<repo-hash>/savings.jsonl
 * so developers can inspect real-world savings via `quiet-cli.mjs stats`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getStoreDir() {
  if (process.env.ZEROBURN_QUIET_LOG_DIR) {
    const dir = path.resolve(process.env.ZEROBURN_QUIET_LOG_DIR);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const repoHash = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
  const dir = path.join(os.tmpdir(), 'zeroburn-ctx', repoHash);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function recordSavings({ label, rawBytes, emittedBytes, engine = 'quiet-cli' }) {
  try {
    const ledgerPath = path.join(getStoreDir(), 'savings.jsonl');
    const raw = Math.max(0, Number(rawBytes) || 0);
    const emitted = Math.max(0, Number(emittedBytes) || 0);
    const entry = { ts: Date.now(), label: String(label || 'cmd'), rawBytes: raw, emittedBytes: emitted, engine };
    fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // telemetry must never break execution
  }
}

export function readStats() {
  const ledgerPath = path.join(getStoreDir(), 'savings.jsonl');
  const byLabel = {};
  let calls = 0;
  let rawBytes = 0;
  let emittedBytes = 0;

  if (fs.existsSync(ledgerPath)) {
    for (const line of fs.readFileSync(ledgerPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        calls += 1;
        rawBytes += e.rawBytes || 0;
        emittedBytes += e.emittedBytes || 0;
        const bucket = byLabel[e.label] || { calls: 0, rawBytes: 0, emittedBytes: 0 };
        bucket.calls += 1;
        bucket.rawBytes += e.rawBytes || 0;
        bucket.emittedBytes += e.emittedBytes || 0;
        byLabel[e.label] = bucket;
      } catch {
        // skip malformed
      }
    }
  }

  const savedBytes = Math.max(0, rawBytes - emittedBytes);
  const savedPct = rawBytes > 0 ? Number(((savedBytes / rawBytes) * 100).toFixed(1)) : 0;
  return { calls, rawBytes, emittedBytes, savedBytes, savedPct, estTokensSaved: Math.round(savedBytes / 4), byLabel };
}

function fmtBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function formatStats(stats) {
  if (stats.calls === 0) return '[quiet-cli] stats: 0 recorded runs yet.\n';
  const width = 32;
  const keptBars = stats.rawBytes > 0 ? Math.max(1, Math.round((stats.emittedBytes / stats.rawBytes) * width)) : 0;
  const barRaw = '█'.repeat(width);
  const barOut = '█'.repeat(Math.min(width, keptBars)) + '░'.repeat(Math.max(0, width - keptBars));
  const lines = [
    `[quiet-cli] stats (${stats.calls} runs): ${fmtBytes(stats.rawBytes)} -> ${fmtBytes(stats.emittedBytes)} (${stats.savedPct}% saved, ~${stats.estTokensSaved.toLocaleString()} tokens kept out)`,
    `  Raw output  |${barRaw}| ${fmtBytes(stats.rawBytes)}`,
    `  In context  |${barOut}| ${fmtBytes(stats.emittedBytes)}`,
  ];
  for (const [label, b] of Object.entries(stats.byLabel)) {
    const pct = b.rawBytes > 0 ? (((b.rawBytes - b.emittedBytes) / b.rawBytes) * 100).toFixed(1) : '0.0';
    lines.push(`  - ${label}: ${b.calls}x (${fmtBytes(b.rawBytes)} -> ${fmtBytes(b.emittedBytes)}, ${pct}% saved)`);
  }
  return `${lines.join('\n')}\n`;
}

export function resetStats() {
  const ledgerPath = path.join(getStoreDir(), 'savings.jsonl');
  if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
}
