# Changelog

All notable changes to **ZeroBurn (`zeroburn`)** are documented in this file.
The canonical version is stored in [`.agents/plugins/zeroburn/plugin.json`](.agents/plugins/zeroburn/plugin.json) and stamped into `.agents/project.config.json` (`zeroburnVersion`) by `node .agents/scripts/init.mjs`.

---

## [2.1.0] - 2026-11-20

### Added
- **1-Command Initializer & Upgrader (`.agents/scripts/init.mjs`):**
  - Auto-detects repository stack (`Next.js`, `React`, `Vue`, `SvelteKit`, `TypeScript`, `Prisma`, `Drizzle`, `Supabase`), directory layout (`src/lib`, `src/app/actions`, `prisma/schema.prisma`), and `codebase-memory-mcp` graph project slug.
  - Supports `--pull` (hardware-aware RAM sizing: `<24GB` -> `7b`, `>=24GB` -> `14b`), `--pin` (locks resolved Ollama tags into `project.config.json`), and `--version` / `-v`.
  - Preserves existing custom `project.config.json` fields when upgrading across `zeroburn` versions while stamping `zeroburnVersion`.
- **Dynamic Local Ollama Model Resolution (`"auto"`):**
  - `workflow_common.py` and `session-start.mjs` query `/api/tags` at runtime and automatically match installed coder models (`qwen3-coder`, `qwen2.5-coder`, `deepseek-coder`, `codellama`, `starcoder`, `codestral`) and prose models (`gemma4`, `gemma3`, `llama3`, `mistral`, `qwen*`, `phi*`) without requiring specific hardcoded tags.
- **Version Drift Detection:**
  - `session-start.mjs` injects `zeroburn=v2.1.0` into the SessionStart context banner and flags if `.agents/project.config.json` is on an older schema version.

---

## [2.0.0] - 2026-11-20

### Added
- **0-Token Knowledge Graph Pre-Fetch (`codebase-memory-mcp`):** Pre-fetches top symbol coordinates before Discovery (`search_graph`) and 2-hop impacted call-graph nodes before Audit (`detect_changes`).
- **Inlined Rule Digests & Dynamic `REPO_MAP_DIGEST`:** Eliminates blank-slate subagent markdown and directory-listing turns.
- **Auto-Start & Fail-Closed Local Ollama Gate:** Automatically spawns `ollama serve` if `127.0.0.1:11434` is down and hard-stops before burning cloud fallback tokens.
- **Quiet CLI Verification (`.agents/scripts/quiet-cli.mjs`):** Compresses `tsc`, `lint`, `unit`, and `pr-check` runs into 1-line receipts (~15 tokens) on pass and caps failure output at 35 lines.
- **Pool-Safe `FALLBACK_CHAINS`:** Steps down through cheaper 5-hour tiers (`pro -> flash -> flash_lite -> inherit`) before touching weekly reserve models.
