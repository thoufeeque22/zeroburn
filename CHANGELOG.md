# Changelog

All notable changes to **ZeroBurn (`zeroburn`)** are documented in this file.
The canonical version is stored in [`.agents/plugins/zeroburn/plugin.json`](.agents/plugins/zeroburn/plugin.json) and stamped into `.agents/project.config.json` (`zeroburnVersion`) by `node .agents/scripts/init.mjs`.

---

## [2.9.1] - 2026-11-24

### Fixed
- **Streaming `quiet-cli.mjs` Without Node's 1 MiB `spawnSync` `maxBuffer` Limit:**
  - Replaced `spawnSync` in `runStep()` with async streaming `spawn` that writes full stdout/stderr directly to a local temp log artifact (`os.tmpdir()`) while maintaining separate bounded stdout/stderr line ring buffers (`200` lines each) in memory—eliminating `ENOBUFS` kills on noisy test suites (`>1 MiB`) and preventing buffered stdout from drowning out stderr diagnostics.
  - Explicitly distinguishes spawn errors (`ERROR (ENOENT)`) and signal kills (`KILLED (signal SIGKILL/SIGTERM)`) from ordinary non-zero test exits, and prints the full streamed log path on failures/kills (auto-cleaning the temp log on green runs).
  - Added `exec` subcommand and regression suite (`benchmarks/test-quiet-cli.mjs`) testing `>1.5 MiB` pass, `>1.5 MiB` fail + disk artifact persistence, `ENOENT`, and `SIGKILL`.

---

## [2.9.0] - 2026-11-23

### Added
- **0-Token Docs & Knowledge Parity Guard (`parallel-audit.py`, `quiet-cli.mjs docs-parity`, `AGENTS.md`, `ORCHESTRATION.md`):**
  - Enforces strict documentation and knowledge parity across **Track S, Track M, and Track L** whenever user-facing routes, actions, billing/quotas, platforms, or schema models change (closing Track S and 4-Handoff Cliff Cap bypasses).
  - Adds `node .agents/scripts/quiet-cli.mjs docs-parity` (integrated into `pr-check`) and a deterministic 0-token Python static parity guard inside `parallel-audit.py`.
- **Dynamic Version Banner (`live-audit.mjs`):**
  - Replaces hardcoded version banners with dynamic `loadPluginVersion()` lookup across `.agents/plugins/*/plugin.json`.

---

## [2.8.0] - 2026-11-22

### Added
- **Live Working-Tree Verification for Graph Pre-Fetch & Repo Digest (`graph_prefetch.py`, `repo_digest.py`):**
  - Verifies every `codebase-memory-mcp` `search_graph` and `detect_changes` hit against the live filesystem (`verify_live_file_entry`), clamping line bounds and emitting `[STALE_INDEX_MISS]` when files moved or were deleted so subagents never trust stale coordinates.
  - Verifies configured `REPO_MAP_DIGEST` paths (`schema`, `libDir`, `actionsDir`, `coreSingletons`) against disk and flags `[STALE - RE-INDEX]` if missing.
- **0-Token Deterministic Route Auth Guard (`parallel-audit.py`, `benchmarks/try-now.mjs`, `live-audit.mjs`):**
  - Deterministically flags non-public Next.js API routes (`src/app/api/**/route.ts`) missing recognizable server-side auth/session guards in pure Python/Node before invoking local Ollama or cloud auditors (with explicit `// public-route-ok` escape hatch).
- **`tokens_to_first_green_edit` Benchmark Metric (`benchmarks/run_benchmark.py`, `benchmarks/try-now.mjs`):**
  - Instruments cumulative billed tokens from subagent spawn through the first passing `tsc`/`vitest` run (Vanilla 4-turn vs. ZeroBurn 2-turn).

### Changed
- **Modularized Python Orchestration Core (`workflow_common.py`):**
  - Split `workflow_common.py` into focused `<=200`-line modules (`ollama_gate.py`, `graph_prefetch.py`, `repo_digest.py`, `workflow_common.py`) while keeping 100% backward-compatible re-exports.
- **Demystified `README.md` & Live ASCII Benchmark:**
  - Replaced internal shorthand with plain engineering descriptions, clarified universal model/harness compatibility (Gemini, Claude, OpenAI, Cursor, Antigravity) and Git-only prerequisites (no GitHub login required), and replaced the static PNG with an always-current live ASCII terminal table.

---

## [2.7.0] - 2026-11-22

### Added
- **1-Command In-Place Upgrade (`node .agents/scripts/init.mjs --upgrade`):**
  - Allows existing users and projects to update ZeroBurn directly from GitHub with 1 command, cleanly replacing `.agents/` while preserving all custom project settings and paths in `.agents/project.config.json`.
- **Automatic In-Session Upgrade Indicator (`session-start.mjs`):**
  - SessionStart hook checks upstream GitHub releases in the background (with a 24-hour local cache) and flags `[UPDATE_AVAILABLE: vX.Y.Z -> run node .agents/scripts/init.mjs --upgrade]` directly in the agent's startup context banner.
- **Stage 0/1 Smart Bypass & Work-Resume Gate (`ORCHESTRATION.md`, `AGENTS.md`, `parallel-discovery.py`, `docs/TIPS_AND_TRICKS.md`):**
  - **Already-In-Progress Branch Auto-Resume (`already_worked_on`):** `parallel-discovery.py` and Stage 0 inspect `git diff --name-only <base>...HEAD` and working-tree changes; if a ticket branch already has commits or active implementation WIP, Stage 1 (`Product || Discovery`) is bypassed in **0 cloud tokens** and execution resumes directly at Stage 2 (`Dev`), Stage 3 (`QA`), or Stage 4 (`Audit`).
  - **Pre-Specced Ticket Discovery Bypass (`skip_discovery=True`):** Skips `discovery-agent` in 0 cloud tokens for Track L child sub-issues (already decomposed by parent Epic Discovery), observation-triage tickets, and detailed bug reports that already declare their target file blast radius and contract, synthesizing `discovery_blueprint.md` directly from the issue body + 0-token `codebase-memory-mcp` `search_graph` pre-fetch.
  - **Selective `product-agent` Trigger (`skip_product=True`):** Extends the 0-token `product-agent` bypass beyond `pure_backend=True` to also skip bug fixes, refactors, performance/a11y fixes, Track L child sub-issues, and pre-specced UI tickets, spawning `product-agent` strictly for net-new UX flows, ambiguous customer copy, or new tier/pricing decisions.

---

## [2.6.0] - 2026-11-22

### Added
- **ZeroBurn Tips, Tricks & Token Optimization Playbook (`docs/TIPS_AND_TRICKS.md`):**
  - Canonical operational playbook covering 1-line minimalist prompt startups (`start orchestration workflow on #1043`), deterministic epic branch auto-discovery without redundant topology prompts, session hygiene (1 ticket per chat, when to use `/compact`), Master Epic Branches, and 0-token test/audit mechanisms.
- **Continuous Knowledge Loop Protocol (`ORCHESTRATION.md`):**
  - Formalizes the continuous learning rule requiring agents and developers to preserve newly discovered workflow optimizations and prompt shortcuts directly into `docs/TIPS_AND_TRICKS.md`.
- **Root README Tips & Tricks Showcase (`README.md`):**
  - Adds a dedicated operational guide section linking developers directly to `docs/TIPS_AND_TRICKS.md`.

---

## [2.5.0] - 2026-11-22

### Added
- **Cloud-Audited Observation Intake (`parallel-audit.py`, `audit-agent.md`):**
  - Persists ONLY cloud-auditor-vetted actionable `medium`/`low` out-of-scope tech debt to `.agents/incidental_observations.json`, attaching `source_ticket` metadata and normalized `(file, reason)` deduplication while dropping raw local Ollama duplicates and informational PR metrics.
- **Hybrid Count-Threshold & Epic-Closure Batch Triage (`ORCHESTRATION.md`, `AGENTS.md`, `doc-agent.md`, `project-agent.md`):**
  - Replaces the dead `high`-only closure trigger with a threshold (`observationsTriageThreshold: 5` in `project.config.json`) on Track M closure and `>= 1` entry on Track L Epic final closure (`epic/<id>-*` -> `main`), routing to `project-agent` for domain-grouped batch issue creation (skipping Track S and intermediate slices).
- **SessionStart `TRIAGE_DUE` Indicator (`session-start.mjs`):**
  - Flags `pending_observations=<count> [TRIAGE_DUE>=5]` in the SessionStart context banner whenever deferred observations reach the configured threshold.

---

## [2.4.0] - 2026-11-21

### Added
- **Track L Master Feature / Epic Branch Protocol (`AGENTS.md`, `ORCHESTRATION.md`, `VARIABLES.md`):**
  - Defines the `epic/<epic-id>-<slug>` master branch strategy for multi-slice epics. Slices branch from and target the epic branch instead of `main`, completely eliminating deep PR stacking and rebase cascading across dependent sub-tasks. When all slices pass their verification gates and audits, the master epic branch merges to `main` atomically.
- **Docs-Only Zero-Test Suite Fast-Path (`AGENTS.md`, `ORCHESTRATION.md`):**
  - Explicitly bypasses `pnpm test`, Vitest, and Playwright E2E test runs when PRs or commits touch ONLY markdown or documentation files (`docs/**`, `*.md`, `.agents/**` rules) with zero application code changes, preserving valuable execution time and compute quota.
- **Mandatory README Evaluation Rule in Orchestration (`ORCHESTRATION.md`):**
  - Requires checking whether `README.md` updates are required on every ZeroBurn engine release.

---

## [2.3.0] - 2026-11-21

### Added
- **Three-Bucket Customer UI Copy Policy & Term-Tooltip Architecture (`UI_UX.md`, `workflow_common.py`):**
  - Enforces interactive `<TermTooltip>` helpers + canonical setup doc links for domain terms, human-readable tier names via `formatTierName()` (banning raw DB enum strings in customer UI), and an internal engineering jargon ban (`OAuth`, `SSRF`, `RBAC`, `Zod`, `RSC`, HTTP status codes, raw DB errors) with a provider-setup-form label exception paired with plain-English helper text.
- **Stage 4 2-Round Audit Cap & Severity Blocking Policy (`ORCHESTRATION.md`, `parallel-audit.py`):**
  - Caps Stage 4 at 2 rounds (Round 2 evaluates ONLY the remediation delta via `previous_ref`) and blocks PR progress strictly on `critical`/`high` security or data-integrity issues while deferring `medium`/`low` observations.
- **Strict Public Isolation & Release Policy (`export-public-orchestrator.mjs`):**
  - Expands `BUSINESS_LEAK_REGEX` and `sanitizePublicContent()` to guarantee zero product/domain-specific vocabulary or doc slugs ever leak into exported ZeroBurn artifacts.

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
