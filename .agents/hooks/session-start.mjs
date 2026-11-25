import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

function loadPluginVersion(cwd) {
  for (const rel of [
    '.agents/plugins/zeroburn/plugin.json',
    '.agents/plugins/zeroburn/plugin.json',
  ]) {
    const p = path.join(cwd, rel);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(p)) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed.version) return parsed.version;
      } catch {
        // fallback
      }
    }
  }
  return '2.10.0';
}

function loadProjectConfig(cwd) {
  for (const rel of ['.agents/project.config.json', '.agents/project.config.example.json']) {
    const p = path.join(cwd, rel);
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

function runGit(cwd, args) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 3000 }).trim();
}

function fetchOllamaModels(ollamaUrl) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const out = execFileSync('curl', ['-sf', '--max-time', '1', `${ollamaUrl}/api/tags`], {
      encoding: 'utf8',
      timeout: 1500,
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed.models)
      ? parsed.models.map((m) => m.name).filter(Boolean)
      : [];
  } catch {
    return null;
  }
}

function checkUpstreamVersion(cwd, currentVersion) {
  try {
    const cacheFile = path.join(os.tmpdir(), 'zeroburn_latest_tag.json');
    let cached = null;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(cacheFile)) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      } catch {
        cached = null;
      }
    }
    const now = Date.now();
    // Cache for 24 hours (86,400,000 ms) so we never spam GitHub API
    if (!cached || !cached.tag || now - (cached.checkedAt || 0) > 86400000) {
      try {
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        const out = execFileSync(
          'curl',
          ['-sf', '--max-time', '1.5', 'https://api.github.com/repos/<owner>/zeroburn/releases/latest'],
          { encoding: 'utf8', timeout: 2000 }
        );
        const parsed = JSON.parse(out);
        if (parsed.tag_name) {
          cached = { tag: parsed.tag_name.replace(/^v/, ''), checkedAt: now };
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          fs.writeFileSync(cacheFile, JSON.stringify(cached), 'utf8');
        }
      } catch {
        // network or rate-limit: ignore silently
      }
    }
    if (cached && cached.tag && cached.tag !== currentVersion) {
      // compare simple semver
      const curParts = currentVersion.split('.').map(Number);
      const upstreamParts = cached.tag.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        const u = upstreamParts[i] || 0;
        const c = curParts[i] || 0;
        if (u > c) return cached.tag;
        if (u < c) break;
      }
    }
    return null;
  } catch {
    return null;
  }
}

const CODER_PATTERNS = [
  'qwen3-coder',
  'qwen2.5-coder',
  'qwen-coder',
  'deepseek-coder',
  'codellama',
  'starcoder',
  'codestral',
  'coder',
  'qwen3',
  'qwen2.5',
  'deepseek',
  'llama3',
  'gemma4',
  'gemma3',
];

const PROSE_PATTERNS = [
  'gemma4',
  'gemma3',
  'gemma2',
  'llama3',
  'mistral',
  'qwen3',
  'qwen2.5',
  'phi4',
  'phi3',
];

function selectBestModel(installed, configured, patterns, fallback) {
  if (configured && configured.toLowerCase() !== 'auto') {
    if (!installed || installed.length === 0 || installed.includes(configured)) return configured;
    const base = configured.split(':')[0];
    const match = installed.find((m) => m.split(':')[0] === base);
    return match || configured;
  }
  if (installed && installed.length > 0) {
    for (const pat of patterns) {
      const found = installed.find((m) => m.toLowerCase().includes(pat));
      if (found) return found;
    }
    return installed[0];
  }
  return fallback;
}

function checkOrStartOllama(ollamaUrl, cfg) {
  let models = fetchOllamaModels(ollamaUrl);
  let state = 'UP';
  if (models === null) {
    try {
      // Attempt non-blocking background auto-start of ollama serve
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
      child.unref();
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      execFileSync('sleep', ['1'], { timeout: 1500 });
      models = fetchOllamaModels(ollamaUrl);
      state = models !== null ? 'UP (auto-started)' : 'STARTING (auto-spawned `ollama serve`)';
    } catch {
      return { status: 'DOWN (HARD-STOP if workflow auto-start fails)', coder: 'none', prose: 'none' };
    }
  }
  const coder = selectBestModel(models || [], cfg.localCoderModel || 'auto', CODER_PATTERNS, 'qwen2.5-coder:7b');
  const prose = selectBestModel(models || [], cfg.localProseModel || 'auto', PROSE_PATTERNS, coder);
  return { status: state, coder, prose };
}

function getPendingObservations(cwd) {
  const obsPath = path.join(cwd, '.agents', 'incidental_observations.json');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(obsPath)) return 0;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const parsed = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
  return Array.isArray(parsed) ? parsed.length : 0;
}

function hasOrchChanges(cwd) {
  try {
    const dirtyOrch = runGit(cwd, ['status', '--porcelain', '.agents']);
    if (dirtyOrch) return true;
    const committedOrch = runGit(cwd, ['diff', '--name-only', 'origin/main...HEAD', '--', '.agents']);
    return Boolean(committedOrch);
  } catch {
    return false;
  }
}

function main() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = raw ? JSON.parse(raw) : {};
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const cfg = loadProjectConfig(cwd);
    const ollamaUrl = (cfg.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const graphProject = cfg.graphProjectId || cwd.replace(/^\//, '').replace(/\//g, '-');
    const branch = runGit(cwd, ['branch', '--show-current']) || 'detached';
    const dirtyOut = runGit(cwd, ['status', '--porcelain']);
    const dirtyCount = dirtyOut ? dirtyOut.split('\n').filter(Boolean).length : 0;
    const obsCount = getPendingObservations(cwd);
    const obsThreshold = Number(cfg.observationsTriageThreshold) || 5;
    const obsFlag = obsCount >= obsThreshold ? ` [TRIAGE_DUE>=${obsThreshold}]` : '';
    const ollama = checkOrStartOllama(ollamaUrl, cfg);
    const version = loadPluginVersion(cwd);
    const cfgVersion = cfg.zeroburnVersion || version;
    const driftNote = cfgVersion !== version ? ` [config=${cfgVersion}->run init.mjs]` : '';
    const upstreamTag = checkUpstreamVersion(cwd, version);
    const updateBanner = upstreamTag ? ` [UPDATE_AVAILABLE: v${upstreamTag} -> run \`node .agents/scripts/init.mjs --upgrade\`]` : '';
    const zeroburnSync = hasOrchChanges(cwd)
      ? 'PENDING (export & push ../zeroburn via `node .agents/scripts/export-public-orchestrator.mjs ../zeroburn`)'
      : 'CLEAN';
    const msg = `Workspace context: zeroburn=v${version}${driftNote}${updateBanner}, branch=${branch}, dirty_files=${dirtyCount}, pending_observations=${obsCount}${obsFlag}, local_ollama=${ollama.status} (coder=${ollama.coder}, prose=${ollama.prose}), graph_project=${graphProject}, zeroburn_sync=${zeroburnSync}. Efficiency rules: (1) Query codebase-memory-mcp directly with project="${graphProject}" (skip list_projects & full-file reads), (2) Batch independent tool calls in parallel turns, (3) Use \`node .agents/scripts/quiet-cli.mjs <tsc|lint|unit|pr-check|api-map|exec|search|stats>\` for 1-line verification logs & FTS5 output search, (4) Follow Hybrid Quota Policy (Options A+B+C) in .agents/base/ORCHESTRATION.md.`;
    process.stdout.write(JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: msg } }] }));
  } catch {
    process.stdout.write('{}');
  }
}

main();
