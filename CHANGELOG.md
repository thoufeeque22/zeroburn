# Changelog

All notable changes to **ZeroBurn (`zeroburn`)** are documented in this file.
The canonical version is stored in [`.agents/plugins/zeroburn/plugin.json`](.agents/plugins/zeroburn/plugin.json) and stamped into `.agents/project.config.json` (`zeroburnVersion`) by `node .agents/scripts/init.mjs`.

---

## [2.2.0] - 2026-11-20

### Added
- **Local Ollama Judgment Kernel (`quiet-cli.mjs`):** On verbose test/lint/build failures (>12 lines), automatically invokes the dynamically resolved local prose model (`gemma4`, `llama3`, etc.) in 0 cloud tokens to emit a 3-line root-cause digest above the capped error tail.
- **0-Token Deterministic Blast-Radius Drift Guard (`parallel-audit.py`):** Compares `git diff --name-only` against file paths declared in the Discovery blueprint in Python (0 LLM tokens) to flag out-of-scope edits before any cloud auditor runs.
- **Parallel Swarm File-Path Leases (`workflow_common.py` + `pre-tool-guard.mjs`):** `claim_file_leases()` / `release_file_leases()` backed by `.agents/swarm_leases.json` prevent parallel swarm workers (`SWARM_WORKER_ID`) from colliding on shared files.
- **0-Token `/api/**` Route Introspection (`quiet-cli.mjs api-map` + `REPO_MAP_DIGEST`):** Scans App Router API routes and HTTP methods in 0 tokens so agents see live endpoints on Turn 1.
- **The 4-Handoff Cliff Cap & Rule Expiry Tags (`ORCHESTRATION.md`):** Caps routine Track M pipelines at `<= 4` handoffs and introduces `[EXPIRY: <condition>]` tags to prune obsolete model workarounds.

---

## [2.1.0] - 2026-11-20

### Added
- **1-Command Initializer & Upgrader (`.agents/scripts/init.mjs`):**
  - Auto-detects repository stack (`Next.js`, `React`, `Vue`, `SvelteKit`, `TypeScript`, `Prisma`, `Drizzle`, `Supabase`), directory layout, and `codebase-memory-mcp` graph project slug.
  - Supports `--pull` (hardware-aware RAM sizing: `<24GB` -> `7b`, `>=24GB` -> `14b`), `--pin`, and `--version` / `-v`.
- **Dynamic Local Ollama Model Resolution (`"auto"`):**
  - `workflow_common.py` and `session-start.mjs` query `/api/tags` at runtime and automatically match installed coder and prose models without hardcoded tags.
- **Version Drift Detection:**
  - `session-start.mjs` injects `zeroburn=v2.2.0` into the SessionStart context banner and flags if `.agents/project.config.json` is on an older schema version.

---

## [2.0.0] - 2026-11-20

### Added
- **0-Token Knowledge Graph Pre-Fetch (`codebase-memory-mcp`):** Pre-fetches top symbol coordinates before Discovery (`search_graph`) and 2-hop impacted call-graph nodes before Audit (`detect_changes`).
- **Inlined Rule Digests & Dynamic `REPO_MAP_DIGEST`:** Eliminates blank-slate subagent markdown and directory-listing turns.
- **Auto-Start & Fail-Closed Local Ollama Gate:** Automatically spawns `ollama serve` if `127.0.0.1:11434` is down and hard-stops before burning cloud fallback tokens.
- **Quiet CLI Verification (`.agents/scripts/quiet-cli.mjs`):** Compresses `tsc`, `lint`, `unit`, and `pr-check` runs into 1-line receipts (~15 tokens) on pass.
- **Pool-Safe `FALLBACK_CHAINS`:** Steps down through cheaper 5-hour tiers (`pro -> flash -> flash_lite -> inherit`) before touching weekly reserve models.
