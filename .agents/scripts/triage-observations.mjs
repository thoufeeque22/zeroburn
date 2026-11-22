#!/usr/bin/env node
/**
 * ZeroBurn Observation Verifier & Triage Helper (`node .agents/scripts/triage-observations.mjs <check|prune>`)
 *
 * Checks pending observations in `.agents/incidental_observations.json` against:
 * 1. Existing GitHub issues (`gh issue list --state all --json number,title,state,url`) to detect existing tickets.
 * 2. Current codebase state (`HEAD` / `origin/main`) to detect if the cited file or pattern was already fixed/removed.
 *
 * Modes:
 *   check - Reports status for each observation (ACTIONABLE, EXISTING_TICKET, RESOLVED_ON_MAIN).
 *   prune - Removes RESOLVED_ON_MAIN and EXISTING_TICKET items from `.agents/incidental_observations.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CWD = process.cwd();
const OBS_PATH = path.join(CWD, '.agents', 'incidental_observations.json');

function fetchGitHubIssues() {
  try {
    const raw = execFileSync(
      'gh',
      ['issue', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,state,url'],
      { cwd: CWD, encoding: 'utf8', timeout: 10000 }
    );
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function extractKeywords(obs) {
  const words = new Set();
  const file = obs.file || '';
  const basename = path.basename(file.split(':')[0]);
  if (basename && basename.length > 3) {
    words.add(basename.replace(/\.[^.]+$/, '').toLowerCase());
  }

  // Extract function / symbol / hook identifiers from observation text
  const codeIdentifiers = (obs.observation || '').match(/`([a-zA-Z0-9_$]+)`/g) || [];
  for (const id of codeIdentifiers) {
    const clean = id.replace(/`/g, '').toLowerCase();
    if (clean.length > 4) words.add(clean);
  }

  return Array.from(words);
}

function findMatchingIssue(obs, issues) {
  const keywords = extractKeywords(obs);
  if (keywords.length === 0) return null;

  for (const issue of issues) {
    const titleLower = issue.title.toLowerCase();
    for (const kw of keywords) {
      if (titleLower.includes(kw)) {
        return issue;
      }
    }
  }
  return null;
}

function checkCodeState(obs) {
  const filePart = (obs.file || '').split(':')[0].trim();
  if (!filePart) return { exists: false, note: 'no file specified' };

  const fullPath = path.join(CWD, filePart);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(fullPath)) {
    return { resolved: true, note: 'file no longer exists' };
  }

  // If observation quotes specific code, verify if that code still appears in the file
  const quotes = (obs.observation || '').match(/'([^']+)'/g) || [];
  if (quotes.length > 0) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const content = fs.readFileSync(fullPath, 'utf8');
    const missingQuotes = quotes
      .map((q) => q.replace(/'/g, ''))
      .filter((q) => q.length > 8 && !content.includes(q));

    if (missingQuotes.length > 0 && missingQuotes.length === quotes.length) {
      return { resolved: true, note: `quoted snippet no longer in ${filePart}` };
    }
  }

  return { resolved: false, note: 'active in code' };
}

function analyzeObservations(obsList, issues) {
  return obsList.map((obs) => {
    const codeCheck = checkCodeState(obs);
    const issueMatch = findMatchingIssue(obs, issues);

    let status = 'ACTIONABLE';
    let detail = '';

    if (codeCheck.resolved) {
      status = 'RESOLVED';
      detail = codeCheck.note;
    } else if (issueMatch) {
      status = 'EXISTING_TICKET';
      detail = `#${issueMatch.number} (${issueMatch.state}): ${issueMatch.title}`;
    }

    return { obs, status, detail, issueMatch };
  });
}

function main() {
  const mode = process.argv[2] || 'check';

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(OBS_PATH)) {
    process.stdout.write(`No observations file found at ${OBS_PATH}\n`);
    return;
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const obsList = JSON.parse(fs.readFileSync(OBS_PATH, 'utf8'));
  if (!Array.isArray(obsList) || obsList.length === 0) {
    process.stdout.write('[triage-observations] No pending observations in .agents/incidental_observations.json (CLEAN).\n');
    return;
  }

  process.stdout.write(`[triage-observations] Analyzing ${obsList.length} observation(s)...\n`);
  const issues = fetchGitHubIssues();
  const results = analyzeObservations(obsList, issues);

  let actionableCount = 0;
  let resolvedCount = 0;
  let ticketCount = 0;

  for (const r of results) {
    const id = r.obs.id || 'OBS-unknown';
    const file = r.obs.file || 'unknown';
    if (r.status === 'ACTIONABLE') {
      actionableCount += 1;
      process.stdout.write(`  [ACTIONABLE] ${id} (${file}) -> ${r.obs.observation.slice(0, 80)}...\n`);
    } else if (r.status === 'RESOLVED') {
      resolvedCount += 1;
      process.stdout.write(`  [RESOLVED]   ${id} (${file}) -> ${r.detail}\n`);
    } else if (r.status === 'EXISTING_TICKET') {
      ticketCount += 1;
      process.stdout.write(`  [TRACKED]    ${id} (${file}) -> ${r.detail}\n`);
    }
  }

  process.stdout.write(
    `\nSummary: ${actionableCount} actionable, ${ticketCount} already tracked, ${resolvedCount} resolved in code.\n`
  );

  if (mode === 'prune') {
    const kept = results.filter((r) => r.status === 'ACTIONABLE').map((r) => r.obs);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(OBS_PATH, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
    process.stdout.write(`[triage-observations] Pruned ${obsList.length - kept.length} items. Kept ${kept.length} actionable observation(s).\n`);
  }
}

main();
