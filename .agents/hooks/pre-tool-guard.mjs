import fs from 'node:fs';
import path from 'node:path';

function respond(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

const allow = () => respond({ decision: 'allow' });
const deny = (reason) => respond({ decision: 'deny', reason });

function countCodeLines(content) {
  const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlocks
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^\s*\/\//.test(line))
    .length;
}

function getWriteContent(args) {
  if (typeof args.Content === 'string') return args.Content;
  if (typeof args.Replacement === 'string') return args.Replacement;
  return '';
}

function checkRestrictedPaths(norm, rawNorm, absTarget, cwd, base) {
  if ((base === '.env' || base.startsWith('.env.')) && base !== '.env.example') {
    return 'Blocked by env-guard: never modify .env files (only .env.example).';
  }
  const inRepo = absTarget === cwd || absTarget.startsWith(`${cwd}${path.sep}`);
  const isLegacyState = rawNorm.includes('/.agents/state/') || norm.includes('/.agents/state/');
  const isLegacyDoc = inRepo && /(?:^|\/)(?:BRIEFING|progress|handoff)\.md$/.test(norm);
  if (isLegacyState || isLegacyDoc) {
    return 'Blocked: .agents/state/ and legacy state files are obsolete. Write artifacts to ARTIFACT_DIR.';
  }
  return null;
}

function hasColorEmoji(content) {
  for (const ch of content) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x2702 && cp <= 0x27B0)) {
      return true;
    }
  }
  return false;
}

function checkUiAndSizeRules(toolName, args, norm, base, content) {
  const isComponent = norm.includes('/src/components/');
  if (isComponent && /eslint-disable[^\n]*max-lines/.test(content)) {
    return 'Blocked: eslint-disable max-lines is forbidden in UI components (src/components/). Extract a sub-component or hook.';
  }
  if (isComponent && norm.endsWith('.tsx') && hasColorEmoji(content)) {
    return 'Blocked: raw Unicode emojis are forbidden in UI components. Use @mui/icons-material icons.';
  }
  const isSrcCode = norm.includes('/src/') && /\.(?:ts|tsx|js|jsx)$/.test(norm);
  const isExempt = /\/src\/(?:__tests__\/|auth\.ts$|lib\/infrastructure\/database\/prisma\.ts$)/.test(norm);
  if (toolName === 'write_file' && !args.Append && isSrcCode && !isExempt) {
    const lines = countCodeLines(content);
    if (lines > 200 && (isComponent || !content.includes('eslint-disable max-lines'))) {
      return `Blocked: ${base} has ${lines} code lines (>200 limit). Split into modular files.`;
    }
  }
  return null;
}

function checkSwarmFileLease(norm, cwd) {
  const workerId = process.env.SWARM_WORKER_ID;
  if (!workerId) return null;
  const leasePath = path.join(cwd, '.agents', 'swarm_leases.json');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(leasePath)) return null;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const leases = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    const rel = path.relative(cwd, norm).replace(/\\/g, '/');
    const owner = leases[rel];
    if (owner && owner !== workerId) {
      return `Blocked by Swarm File-Lease Guard: ${rel} is exclusively leased by swarm worker "${owner}" (current worker: "${workerId}").`;
    }
  } catch {
    // ignore malformed lease file
  }
  return null;
}

function checkFileWrite(toolName, args, cwd) {
  const rawPath = typeof args.Path === 'string' ? args.Path : '';
  const content = getWriteContent(args);
  const absTarget = path.resolve(cwd, rawPath);
  const norm = absTarget.replace(/\\/g, '/');
  const rawNorm = rawPath.replace(/\\/g, '/');
  const base = path.basename(norm);

  return (
    checkRestrictedPaths(norm, rawNorm, absTarget, cwd, base) ??
    checkSwarmFileLease(norm, cwd) ??
    checkUiAndSizeRules(toolName, args, norm, base, content)
  );
}

function isDirectPushToMain(cmd) {
  for (const segment of cmd.split(/[;&|\n]+/)) {
    if (!/\bgit\s+push\b/.test(segment) || /\s--dry-run(?:\s|$)/.test(segment)) continue;
    const tokens = segment.trim().split(/\s+/);
    const pushIdx = tokens.indexOf('push');
    if (pushIdx === -1) continue;
    const argsAfterPush = tokens.slice(pushIdx + 1);
    if (argsAfterPush.some((tok) => tok === 'main' || tok.endsWith(':main'))) {
      return true;
    }
  }
  return false;
}

function checkCommand(args) {
  const cmd = typeof args.CommandLine === 'string' ? args.CommandLine : '';
  if (/(?:^|[;&|]\s*)npm\s+(?:install|i|ci)\b/.test(cmd)) {
    return 'Blocked: use pnpm install instead of npm.';
  }
  if (isDirectPushToMain(cmd)) {
    return 'Blocked: never push directly to main. Push your feature branch and open a PR.';
  }
  if (/\bssh\b[^\n]*next\s+build/.test(cmd)) {
    return 'Blocked: never run next build on the 1GB VPS. Build locally or in CI and use pnpm run deploy:vps.';
  }
  return null;
}

function main() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = raw ? JSON.parse(raw) : {};
    const toolCall = payload.toolCall || {};
    const name = String(toolCall.name || '');
    const args = toolCall.args || {};
    const cwd = path.resolve(typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());

    if (name === 'write_file' || name === 'edit_file') {
      const reason = checkFileWrite(name, args, cwd);
      if (reason) deny(reason);
    } else if (name === 'run_command') {
      const reason = checkCommand(args);
      if (reason) deny(reason);
    }
    allow();
  } catch {
    allow();
  }
}

main();
