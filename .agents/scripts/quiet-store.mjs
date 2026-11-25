/**
 * Zero-dependency local FTS5 output spillover index for quiet-cli.mjs.
 * - Uses built-in `node:sqlite` FTS5 (BM25 + Porter stemming) on Node >=22.5.
 * - Falls back gracefully to JSONL token scoring on older Node 18-22.4 runtimes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getStoreDir } from './quiet-stats.mjs';

export { formatStats, getStoreDir, readStats, recordSavings, resetStats } from './quiet-stats.mjs';

const MAX_CHUNK_BYTES = 2048;
const MAX_SNIPPET_CHARS = 600;
const FALLBACK_MAX_CHUNKS = 2000;

let sqliteModulePromise = null;

async function loadSqlite() {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import('node:sqlite')
      .then((mod) => (typeof mod?.DatabaseSync === 'function' ? mod.DatabaseSync : null))
      .catch(() => null);
  }
  return sqliteModulePromise;
}

export function chunkText(text, maxBytes = MAX_CHUNK_BYTES) {
  const lines = String(text || '').split(/\r?\n/);
  const chunks = [];
  let buf = [];
  let bufBytes = 0;

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (buf.length > 0 && bufBytes + lineBytes > maxBytes) {
      chunks.push(buf.join('\n'));
      buf = [];
      bufBytes = 0;
    }
    if (lineBytes > maxBytes) {
      for (let i = 0; i < line.length; i += maxBytes) chunks.push(line.slice(i, i + maxBytes));
      continue;
    }
    buf.push(line);
    bufBytes += lineBytes;
  }
  if (buf.length > 0) chunks.push(buf.join('\n'));
  return chunks.filter((c) => c.trim().length > 0);
}

function tokenizeQuery(query) {
  return String(query || '').toLowerCase().match(/[a-z0-9_]+/g)?.filter((t) => t.length >= 2) ?? [];
}

function buildFtsQuery(tokens, joiner = ' ') {
  return tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(joiner);
}

async function openDb() {
  const DatabaseSync = await loadSqlite();
  if (!DatabaseSync) return null;
  const db = new DatabaseSync(path.join(getStoreDir(), 'context.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sources (
      source_id TEXT PRIMARY KEY, label TEXT NOT NULL, command TEXT NOT NULL,
      exit_code INTEGER, raw_bytes INTEGER NOT NULL, chunk_count INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL,
      chunk_idx INTEGER NOT NULL, label TEXT NOT NULL, content TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      label, content, content='chunks', content_rowid='id', tokenize='porter unicode61'
    );
  `);
  return db;
}

export async function indexOutput({ label, command, text, exitCode = 0 }) {
  const rawBytes = Buffer.byteLength(String(text || ''), 'utf8');
  const chunks = chunkText(text);
  const sourceId = `s${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  if (chunks.length === 0) return { sourceId, chunkCount: 0, engine: 'empty' };

  const db = await openDb();
  if (db) {
    try {
      db.exec('BEGIN');
      db.prepare(
        'INSERT INTO sources (source_id, label, command, exit_code, raw_bytes, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(sourceId, label, command, exitCode ?? -1, rawBytes, chunks.length, Date.now());
      const insChunk = db.prepare('INSERT INTO chunks (source_id, chunk_idx, label, content) VALUES (?, ?, ?, ?)');
      const insFts = db.prepare('INSERT INTO chunks_fts (rowid, label, content) VALUES (?, ?, ?)');
      chunks.forEach((content, idx) => {
        const info = insChunk.run(sourceId, idx, label, content);
        insFts.run(info.lastInsertRowid, label, content);
      });
      db.exec('COMMIT');
      return { sourceId, chunkCount: chunks.length, engine: 'sqlite-fts5' };
    } finally {
      db.close();
    }
  }

  const rows = chunks.map((content, idx) => JSON.stringify({ sourceId, chunkIdx: idx, label, content }));
  fs.appendFileSync(path.join(getStoreDir(), 'chunks.jsonl'), `${rows.join('\n')}\n`, 'utf8');
  return { sourceId, chunkCount: chunks.length, engine: 'jsonl-fallback' };
}

function clipSnippet(content, tokens) {
  const text = String(content || '').trim();
  if (text.length <= MAX_SNIPPET_CHARS) return text;
  const lower = text.toLowerCase();
  let hitPos = -1;
  for (const tok of tokens) {
    const idx = lower.indexOf(tok);
    if (idx !== -1 && (hitPos === -1 || idx < hitPos)) hitPos = idx;
  }
  const start = hitPos > 80 ? hitPos - 80 : 0;
  const slice = text.slice(start, start + MAX_SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${slice}${start + MAX_SNIPPET_CHARS < text.length ? '…' : ''}`;
}

export async function searchOutputs(query, { sourceId = null, limit = 5 } = {}) {
  const tokens = tokenizeQuery(query);
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  if (tokens.length === 0) return { hits: [], engine: 'none' };

  const db = await openDb();
  if (db) {
    try {
      const runQuery = (ftsExpr) => {
        const filter = sourceId ? 'AND c.source_id = ?' : '';
        const sql = `SELECT c.source_id, c.chunk_idx, c.label, c.content, bm25(chunks_fts) AS score
          FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
          WHERE chunks_fts MATCH ? ${filter} ORDER BY score LIMIT ?`;
        const stmt = db.prepare(sql);
        return sourceId ? stmt.all(ftsExpr, sourceId, safeLimit) : stmt.all(ftsExpr, safeLimit);
      };
      let rows = runQuery(buildFtsQuery(tokens, ' '));
      if (rows.length === 0 && tokens.length > 1) rows = runQuery(buildFtsQuery(tokens, ' OR '));
      return {
        engine: 'sqlite-fts5',
        hits: rows.map((r) => ({
          sourceId: r.source_id,
          chunkIdx: r.chunk_idx,
          label: r.label,
          snippet: clipSnippet(r.content, tokens),
        })),
      };
    } finally {
      db.close();
    }
  }

  const fallbackPath = path.join(getStoreDir(), 'chunks.jsonl');
  if (!fs.existsSync(fallbackPath)) return { hits: [], engine: 'jsonl-fallback' };
  const scored = [];
  for (const line of fs.readFileSync(fallbackPath, 'utf8').trim().split('\n').slice(-FALLBACK_MAX_CHUNKS)) {
    try {
      const row = JSON.parse(line);
      if (sourceId && row.sourceId !== sourceId) continue;
      const hay = `${row.label} ${row.content}`.toLowerCase();
      const score = tokens.reduce((acc, tok) => acc + (hay.includes(tok) ? 1 : 0), 0);
      if (score > 0) scored.push({ row, score });
    } catch {
      // skip malformed line
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    engine: 'jsonl-fallback',
    hits: scored.slice(0, safeLimit).map(({ row }) => ({
      sourceId: row.sourceId,
      chunkIdx: row.chunkIdx,
      label: row.label,
      snippet: clipSnippet(row.content, tokens),
    })),
  };
}

export function purgeStore() {
  const dir = getStoreDir();
  for (const name of ['context.db', 'context.db-wal', 'context.db-shm', 'chunks.jsonl', 'savings.jsonl']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
