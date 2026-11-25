#!/usr/bin/env node
/**
 * ZeroBurn 1-Command Initializer (`node .agents/scripts/init.mjs`)
 * - Auto-detects repository stack, paths, and codebase-memory-mcp graph project slug
 * - Auto-starts local Ollama if down, scans installed models dynamically, or recommends/pulls hardware-sized defaults
 * - Writes/updates .agents/project.config.json in 1 step
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

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
        // ignore
      }
    }
  }
  return '2.10.1';
}

const UPSTREAM_REPO = process.env.ZEROBURN_UPSTREAM_REPO || 'thoufeeque22/zeroburn';

function detectHardwareDefaults() {
  const ramGb = Math.round(os.totalmem() / 1024 ** 3);
  const coder = ramGb >= 24 ? 'qwen2.5-coder:14b' : 'qwen2.5-coder:7b';
  const prose = ramGb >= 16 ? 'gemma4:latest' : 'llama3.2:3b';
  return { ramGb, coder, prose };
}

function detectRepoStack(cwd) {
  let pkg = {};
  const pkgPath = path.join(cwd, 'package.json');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (fs.existsSync(pkgPath)) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      pkg = {};
    }
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const parts = [];
  if (deps.next) parts.push('Next.js App Router');
  else if (deps.react) parts.push('React');
  else if (deps.vue) parts.push('Vue');
  else if (deps.svelte) parts.push('SvelteKit');

  if (deps.typescript || fs.existsSync(path.join(cwd, 'tsconfig.json'))) parts.push('TypeScript');
  if (deps.prisma || deps['@prisma/client'] || fs.existsSync(path.join(cwd, 'prisma/schema.prisma'))) {
    parts.push('Prisma');
  } else if (deps['drizzle-orm']) {
    parts.push('Drizzle');
  }
  if (deps['@supabase/supabase-js']) parts.push('Supabase');

  const projectName = pkg.name || path.basename(cwd);
  const stackSummary = parts.length > 0 ? parts.join(' + ') : 'TypeScript / Node.js Repository';
  const libDir = fs.existsSync(path.join(cwd, 'src/lib'))
    ? 'src/lib'
    : fs.existsSync(path.join(cwd, 'lib'))
      ? 'lib'
      : 'src';
  const actionsDir = fs.existsSync(path.join(cwd, 'src/app/actions'))
    ? 'src/app/actions'
    : fs.existsSync(path.join(cwd, 'app/actions'))
      ? 'app/actions'
      : `${libDir}/actions`;
  const schema = fs.existsSync(path.join(cwd, 'prisma/schema.prisma')) ? 'prisma/schema.prisma' : '';

  return {
    projectName,
    stackSummary,
    paths: {
      schema,
      libDir,
      actionsDir,
      coreSingletons: `${libDir}/core/*`,
    },
  };
}

function fetchOllamaModels(ollamaUrl) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const out = execFileSync('curl', ['-sf', '--max-time', '1.5', `${ollamaUrl}/api/tags`], {
      encoding: 'utf8',
      timeout: 2000,
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed.models) ? parsed.models.map((m) => m.name).filter(Boolean) : [];
  } catch {
    return null;
  }
}

function ensureOllamaAndResolveModels(ollamaUrl, shouldPull, hw) {
  let models = fetchOllamaModels(ollamaUrl);
  if (models === null) {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
      child.unref();
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      execFileSync('sleep', ['1.5'], { timeout: 2500 });
      models = fetchOllamaModels(ollamaUrl);
    } catch {
      models = null;
    }
  }

  const installed = models || [];
  const pick = (patterns) => {
    for (const pat of patterns) {
      const hit = installed.find((m) => m.toLowerCase().includes(pat));
      if (hit) return hit;
    }
    return null;
  };

  let coder = pick(CODER_PATTERNS);
  let prose = pick(PROSE_PATTERNS);

  if (!coder && shouldPull && models !== null) {
    process.stdout.write(`[zeroburn init] Pulling hardware-matched coder model (${hw.coder})...\n`);
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    spawnSync('ollama', ['pull', hw.coder], { stdio: 'inherit' });
    coder = hw.coder;
  }
  if (!prose && shouldPull && models !== null) {
    process.stdout.write(`[zeroburn init] Pulling hardware-matched prose model (${hw.prose})...\n`);
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    spawnSync('ollama', ['pull', hw.prose], { stdio: 'inherit' });
    prose = hw.prose;
  }

  return {
    reachable: models !== null,
    installed,
    resolvedCoder: coder || hw.coder,
    resolvedProse: prose || coder || hw.prose,
    usedExisting: Boolean(coder),
  };
}

function main() {
  const cwd = process.cwd();
  const args = new Set(process.argv.slice(2));
  let pluginVersion = loadPluginVersion(cwd);

  if (args.has('--version') || args.has('-v')) {
    process.stdout.write(`zeroburn v${pluginVersion}\n`);
    return;
  }

  const cfgPath = path.join(cwd, '.agents', 'project.config.json');
  const examplePath = path.join(cwd, '.agents', 'project.config.example.json');
  let savedUserCfg = null;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (fs.existsSync(cfgPath)) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      savedUserCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch {
      savedUserCfg = null;
    }
  }

  if (args.has('--upgrade')) {
    process.stdout.write(`[zeroburn upgrade] Fetching latest ZeroBurn release from GitHub (${UPSTREAM_REPO})...\n`);
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const releaseJson = execFileSync(
        'curl',
        ['-sf', '--max-time', '5', `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`],
        { encoding: 'utf8', timeout: 6000 }
      );
      const parsed = JSON.parse(releaseJson);
      const latestTag = parsed.tag_name || 'main';
      process.stdout.write(`[zeroburn upgrade] Found latest release: ${latestTag}. Downloading...\n`);
      const tmpDir = path.join(os.tmpdir(), `zb-upgrade-${Date.now()}`);
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      execFileSync('git', ['clone', '--depth', '1', '--branch', latestTag, `https://github.com/${UPSTREAM_REPO}`, tmpDir], {
        stdio: 'inherit',
        timeout: 20000,
      });
      const agentsSrc = path.join(tmpDir, '.agents');
      const agentsDest = path.join(cwd, '.agents');
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (fs.existsSync(agentsSrc)) {
        const srcCfgPath = path.join(agentsSrc, 'project.config.json');
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        fs.cpSync(agentsSrc, agentsDest, {
          recursive: true,
          filter: (src) => !(savedUserCfg && path.resolve(src) === path.resolve(srcCfgPath)),
        });
        pluginVersion = loadPluginVersion(cwd);
        process.stdout.write(`[zeroburn upgrade] Updated .agents/ to ${latestTag} successfully.\n`);
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      process.stderr.write(`[zeroburn upgrade] Failed to download upgrade: ${err.message}\n`);
      process.stderr.write(`Fallback manual command:\n  git clone --depth 1 https://github.com/${UPSTREAM_REPO} /tmp/zb && cp -R /tmp/zb/.agents . && rm -rf /tmp/zb && node .agents/scripts/init.mjs\n`);
      return;
    }
  }

  const shouldPull = args.has('--pull');
  const pinModels = args.has('--pin');

  let templateCfg = {};
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (fs.existsSync(examplePath)) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      templateCfg = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
    } catch {
      templateCfg = {};
    }
  }
  const baseCfg = savedUserCfg ? { ...templateCfg, ...savedUserCfg } : templateCfg;

  const prevVersion = baseCfg.zeroburnVersion || 'unversioned';
  const hw = detectHardwareDefaults();
  const repo = detectRepoStack(cwd);
  const ollamaUrl = (baseCfg.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const ollama = ensureOllamaAndResolveModels(ollamaUrl, shouldPull, hw);
  const graphProjectId = baseCfg.graphProjectId || cwd.replace(/^\//, '').replace(/\//g, '-');

  const hasCustomProject = baseCfg.projectName && baseCfg.projectName !== 'my-app';
  const nextCfg = {
    zeroburnVersion: pluginVersion,
    ...baseCfg,
    projectName: hasCustomProject ? baseCfg.projectName : repo.projectName,
    brandName: baseCfg.brandName && baseCfg.brandName !== 'my-app' ? baseCfg.brandName : repo.projectName,
    stackSummary:
      hasCustomProject && baseCfg.stackSummary ? baseCfg.stackSummary : repo.stackSummary,
    graphProjectId,
    ollamaUrl,
    requiredLocalModels: pinModels ? [ollama.resolvedCoder, ollama.resolvedProse] : ['auto'],
    localCoderModel: pinModels ? ollama.resolvedCoder : 'auto',
    localProseModel: pinModels ? ollama.resolvedProse : 'auto',
    observationsTriageThreshold: Number(baseCfg.observationsTriageThreshold) || 5,
    paths: {
      ...repo.paths,
      ...(hasCustomProject ? baseCfg.paths || {} : {}),
    },
  };
  nextCfg.zeroburnVersion = pluginVersion;

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.writeFileSync(cfgPath, `${JSON.stringify(nextCfg, null, 2)}\n`, 'utf8');

  const versionBanner =
    prevVersion !== pluginVersion
      ? `v${pluginVersion} (migrated config from ${prevVersion})`
      : `v${pluginVersion}`;

  process.stdout.write(
    [
      `[zeroburn init] ZeroBurn ${versionBanner} — Configured .agents/project.config.json`,
      `  - Project: ${nextCfg.projectName} (${nextCfg.stackSummary})`,
      `  - Graph Slug: ${graphProjectId}`,
      `  - System RAM: ${hw.ramGb} GB`,
      `  - Local Ollama (${ollamaUrl}): ${ollama.reachable ? 'UP' : 'NOT REACHABLE'} (${ollama.installed.length} installed models)`,
      `  - Dynamic Coder Model: ${ollama.resolvedCoder} (mode: ${nextCfg.localCoderModel})`,
      `  - Dynamic Prose Model: ${ollama.resolvedProse} (mode: ${nextCfg.localProseModel})`,
      !ollama.usedExisting
        ? `  - Tip: No local coder model detected yet. Run \`node .agents/scripts/init.mjs --pull\` or \`ollama pull ${hw.coder}\` to pull one automatically.`
        : `  - Ready! Existing local models will be used automatically with 0 config edits.`,
    ].join('\n') + '\n'
  );
}

main();
