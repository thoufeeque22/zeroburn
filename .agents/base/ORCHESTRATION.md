# Agent Orchestration & Workflow

> Read by the **Main Orchestrator** (subagents read their template + referenced domain docs only).
> Use constants from [VARIABLES.md](VARIABLES.md) exclusively.

## 1. Hybrid Quota-Conservation & Automatic Best-Model Routing Policy (Options A + B + C)

The user grants standing authorization for the Orchestrator to enforce the **Hybrid Quota-Conservation Policy** across all stages:

- **Auto-Start & Fail-Closed Local Ollama Gate:**
  - Before starting Stage 1 (`Product || Discovery`), Stage 2 (`Dev` diff/boilerplate offload), or Stage 4 (`Audit`), local Ollama (`127.0.0.1:11434`) MUST be running with `qwen2.5-coder:14b-custom` and `gemma4:latest` available.
  - Both [.agents/hooks/session-start.mjs](.agents/hooks/session-start.mjs) and `ensure_local_ollama_up()` in [.agents/scripts/workflow_common.py](.agents/scripts/workflow_common.py) **automatically start `ollama serve` in the background** (`ollama serve` / `open -g -a Ollama`) and poll for up to 10s when `127.0.0.1:11434` is down.
  - Only if auto-start fails after 10s (or required local models are not pulled) do `parallel-discovery.py`, `parallel-audit.py`, and the Orchestrator **HARD-STOP** rather than silently burning cloud quota (unless `allow_cloud_only=True` is explicitly approved).
- **Option A — Zero-Token Static Pre-Checks + Graph Pre-Fetch + Local Ollama Offload + 1 Consolidated Cloud Auditor:**
  - **Zero-Token Rule:** Never spend LLM tokens on checks already enforced by `.agents/hooks.json`, `pnpm pr-check`, or Python static guards (`parallel-audit.py` runs 0-token Python checks for blast radius, `≤ 100` line modularity, `'use server'` line 1, and explicit `any`).
  - **Zero-Turn Graph Pre-Fetch & Inlined Rule Digests (`workflow_common.py`):**
    - `parallel-discovery.py` pre-fetches top matching graph nodes via `codebase-memory-mcp` -> `search_graph(project="<your-graph-project-id>", query=summary, limit=15, include_connected=True)` in **0 LLM tokens** and injects exact `file_path:start_line-end_line` + `qualified_name` coordinates into the `discovery-agent` prompt.
    - `parallel-audit.py` pre-fetches 2-hop impacted call-graph symbols via `codebase-memory-mcp` -> `detect_changes(project="<your-graph-project-id>", base_branch="main", depth=2)` in **0 LLM tokens** and injects them into the `audit-agent` prompt.
    - `workflow_common.py` injects pre-compressed digests of `CORE.md`, `PRODUCTION.md`, `UI_UX.md`, and the `GRAPH_MCP_CHEATSHEET` directly into subagent prompts so subagents never spend tool turns calling `read_file` on `.agents/base/*.md`, reading lazy MCP schema JSONs, calling `list_projects`, or reading full source files when a symbol snippet (`get_code_snippet` or `StartLine..EndLine`) suffices.
  - **Local Ollama Offloading (`ollama_chat` / `127.0.0.1:11434`):**
    - `qwen2.5-coder:14b-custom`: mandatory first-pass git diff review in `parallel-audit.py`, privacy-sensitive `.env*`/secrets inspection, and boilerplate/unit-test drafting.
    - `gemma4:latest`: transcript learning extraction, orchestration doc audits, long CI/Playwright log summaries, and PR prose drafts.
  - **Consolidated Cloud Audit:** Stage 4 spawns **1 consolidated cloud `audit-agent`** (receiving the pre-computed static + graph impact + local Ollama findings) instead of 3 parallel cloud subagents (~65% cloud quota reduction).
- **Option B — Track-Aware `flash`-First Subagent Tiering & Argon-Safe `FALLBACK_CHAINS`:**
  - `flash` (Default for Track S & Standard Track M): `product-agent`, standard Track M `discovery-agent` (backed by deterministic `codebase-memory-mcp`), routine `qa-agent`, `browser` visual spot-checks, standard Track M `audit-agent`, `doc-agent`, `project-agent`, Track S edits (`cavecrew-builder`).
  - `pro` (Reserved for High-Risk & Track L): Track L `discovery-agent`, pricing strategy `product-agent`, Track L `dev-agent`, `system-agent`, and any `discovery-agent` / `audit-agent` / `qa-agent` run touching high-risk paths (`src/lib/auth/`, `src/lib/billing/`, `src/lib/ai/`, `src/app/api/webhooks/`, `prisma/schema.prisma`).
  - `inherit`: Track M `dev-agent`.
  - `flash_lite`: High-volume `run_workflow` fan-outs (20+ file scans, bulk lint triage).
  - **Argon-Safe Quota-Exhaustion Fallback Chain (`FALLBACK_CHAINS`):** When a designated tier hits `RESOURCE_EXHAUSTED` / `429`, cascade down cheaper 5-hour tiers **before** falling back to `"inherit"` (`pro -> flash -> flash_lite -> inherit`; `flash -> flash_lite -> pro -> inherit`) so a weekly-reset main-thread model (`Gemini 4 Argon`) is never drained first. Check `swarm(action="models", all=true)` quotas to switch to an available cross-family 5-hour pool (`Gemini 4 Neon`, `Claude Sonnet 5.5`, `GPT-OSS 120B`).
- **Option C — Quota Pool Rotation, 20/80 Thinking Split & Context Hygiene (7 Efficiency Rules):**
  1. **Parallel Tool Batching ($O(N^2)$ Turn Reduction):** Batch all independent `read_file`, `edit_file`, and `call_mcp_tool` calls into 1 parallel turn; never run sequential single-tool turns when targets are known.
  2. **Quiet CLI Verification (`QUIET_CLI_CMD`):** During iterative Dev/QA/Doc checks, run `node .agents/scripts/quiet-cli.mjs <tsc|lint|unit|pr-check>` so passing runs emit 1 line (~15 tokens) and failures cap at 35 lines instead of dumping 500-line logs into chat history.
  3. **20/80 Thinking Effort Split & Pool Rotation:**
     - **Pool A (5h rolling — `Gemini 4 Neon`, `Gemini 3.8 Flash`, `Orchestrator (Neon)`)** & **Pool B (5h rolling — `Claude Sonnet 5.5`, `Claude Opus 5.5`, `GPT-OSS 120B`)**: Primary daily drivers. Use `(Medium)` thinking effort for the 80% implementation/test loop; reserve `(High)` strictly for the 20% Track L architectural design.
     - **Pool C (7-day weekly reserve — `Gemini 4 Argon`, `Orchestrator (Argon)`)**: Keep as weekly emergency reserve or deep Track L planning; switch back to Pool A or Pool B as soon as their 5-hour window resets.
  4. **One-Shot Codemods for Multi-File Refactors (`≥ 4` files):** For mechanical renames, import updates, or pattern changes across `≥ 4` files, execute a single 1-shot Python/Node transform script in 1 turn instead of N `edit_file` calls, then verify with `node .agents/scripts/quiet-cli.mjs tsc`.
  5. **Pre-Computed `REPO_MAP_DIGEST` + Graph Pre-Fetch:** `workflow_common.py` dynamically builds and injects `REPO_MAP_DIGEST` (all Prisma models, `src/lib/*` domains, `src/app/actions/*` paths, core singletons) so agents never spend turns listing directories.
  6. **Caveman Output Compression:** Subagents and internal workflow stages reply in terse caveman-compressed bullet receipts / strict JSON (`file:line` + action/reason only; zero pleasantries or filler prose).
  7. **Artifact-Checkpoint Compaction (`/compact`):** Use one chat per ticket and recommend `/compact` after Stage 1 (`Discovery`) or Stage 2 (`Development`) when conversation history exceeds ~15 tool turns.
- **Track L Cross-Family Swarm Matrix (`swarm`, epics with parallel non-overlapping slices):**
  - Builders (Next.js/TS/Prisma/MUI): `Claude Sonnet 5.5 (Medium)` (or `Claude Opus 5.5 (High)` for complex slices) in `workspace: "share"`.
  - Deep Discovery & Cross-Family Verifier / Security Auditor: `Gemini 4 Neon (High)` (or `Gemini 4 Argon (High)` reserve) in `workspace: "inherit"`.
  - Fast Helpers (Docs, Issue Triage, Simple Tests): `Gemini 3.8 Flash (Medium)` or `Claude Sonnet 5.5 (Low)`.
  - Bulk / Fallback Code Worker: `GPT-OSS 120B (Medium)`.

## 2. Stage 0: Initialization, Worktree Option & Track Triage

Follow `Issue -> Branch/Worktree -> Triage -> Artifact`:
1. **Resolve Ticket ID:** Parse request or query GitHub (`gh issue view <num>`). Never invent an ID. If no issue exists, invoke `project-agent` (`Model="flash"`) first.
2. **Pre-Flight Branch Guard (Zero-Stranded Branch Policy):**
   - Run `git rev-list --count HEAD ^origin/main`. If ahead, check `gh pr list --head $(git branch --show-current) --state all --json state,number`:
     - `MERGED` or `OPEN`: Safe to switch.
     - `CLOSED` (unmerged) or **No PR found**, OR current branch has active WIP: **do NOT switch branches in place.** Create an isolated worktree from `main` (`git worktree add <path> -b <FEATURE_BRANCH_PATTERN> main`) or get explicit user permission first.
   - Otherwise: `git checkout main && git pull`, then `git checkout -b <FEATURE_BRANCH_PATTERN>` (or switch to existing).
3. **T-Shirt Track Triage:**
   - **Track S (Quick Fix / Chore):** ≤ 3 files, zero DB schema, tier, security, or UI-architecture changes.
   - **Track M (Standard Feature / Bug):** 1 PR, ≤ ~10 files.
   - **Track L (Complex Epic):** > 2 phases, > 10 files, or spans schema + billing + security + UI/mobile.
4. **Initial Artifact:** Write ticket plan/status via `write_file` in `ARTIFACT_DIR`.

## 3. Epic Sub-Issue Splitting Protocol (Hybrid Rule)

- **Track S / Track M:** **Do NOT split into GitHub sub-issues.** Track steps inside `ARTIFACT_DIR/plan.md`.
- **Track L (Epic):** Split at the end of **Discovery (BEFORE coding)** into 2–4 **vertical**, independently mergeable **Native GitHub Sub-Issues** linked via `./scripts/link-gh-subissue.sh`. Each sub-issue gets its own blast radius, PR, and verification gate.
- **Mid-Implementation Escape Hatch:** Split during Dev ONLY if blast radius expands > 30% or uncovers an unrelated prerequisite refactor -> spawn 1 linked sub-issue so the active PR stays small.

## 4. Workflow Tracks & Human Gates

### Track S Fast Path
`Branch Init -> Dev (inline / cavecrew-builder / flash) -> tsc + lint + targeted Vitest -> Pre-PR Sync -> PR` *(skips Product, Discovery, Audit, manual docs, and transcript mining)*.

### Track M / Track L Pipeline (Contract-First TDD, Selector-Last E2E)
1. **Stage 1 — `Product || Discovery`:** Run `product-agent` (`flash`, skipped in 0 tokens when `pure_backend=True`) and `discovery-agent` (`flash` on standard Track M; `pro` on Track L or high-risk auth/billing/schema/AI) concurrently via `run_workflow(ScriptPath=PARALLEL_DISCOVERY_WORKFLOW)` (hard-stops if local Ollama is down). Output `ARTIFACT_DIR/discovery_blueprint.md` containing the 5-Dimension Blast Radius, **QA Acceptance Contract + `data-testid` spec**, and (for Track L) the Sub-Issue Split Proposal.
   - **Human Gate #1:** Pause ONLY if Verdict is `NEEDS-INFO` / `REJECTED` or Track L Sub-Issue split needs approval.
2. **Stage 2 — `Development` (`dev-agent`):** Write Vitest unit/Server Action contract tests FIRST, implement modular code (`≤ 100` lines) within Blast Radius (using `architect` on Track L only), spot-check live UI with `browser` (`flash`) + `agentation` MCP, and run `TYPE_CHECK_CMD`, `LINT_CMD`, `UNIT_TEST_CMD`, `SMOKE_TEST_CMD`.
3. **Stage 3 — `QA Verification` (`qa-agent`):** Write/run Playwright `E2E_TEST_FILE_PATTERN` against real `data-testid`s (Reload Rule + Dual-Persona Tier Gate + Light/Dark `checkA11y` + `375px` overflow + screenshots in `SCREENSHOT_DIR`) and **compile `ARTIFACT_DIR/visual_testing_evidence.md`**. Author `MANUAL_TEST_FILE_PATTERN` ONLY for flows Playwright cannot automate.
4. **Stage 4 — `Hybrid Audit` (`PARALLEL_AUDIT_WORKFLOW`):** Hard-stops if local Ollama is down. Runs: (a) 0-token Python static checks (modularity `≤ 100` lines, `'use server'` line 1, zero `any`), (b) local Ollama `qwen2.5-coder:14b-custom` git diff review (0 cloud tokens), and (c) **1 consolidated cloud `audit-agent`** (`flash` on standard Track M; `pro` on Track L or diffs touching `auth/`, `billing/`, `ai/`, `webhooks/`, or `prisma/schema.prisma`).
   - **Auto-Route Loops on `FAIL`:** `TESTS_REQUIRED: YES -> QA -> Dev -> Audit`; `TESTS_REQUIRED: NO -> Dev -> Audit`. Round 2+ artifacts MUST include Root Cause / Gap Analysis.
5. **Human Gate #2 — Post-Audit Visual Sign-Off:** Present `ARTIFACT_DIR/visual_testing_evidence.md` (compiled in Stage 3) for user visual approval before PR creation.
6. **Stage 5 — `Documentation & Pre-PR Closure` (`doc-agent`, `flash`):** Complete Section 6 checks before asking to commit/push.

## 5. Incidental Observations & Decoupled Hygiene

- Append out-of-scope debt discovered in any stage to `OBSERVATIONS_FILE` (`{ "id": "OBS-<timestamp>", "discovery_agent": "...", "observation": "...", "file": "path:line", "severity": "low|medium|high" }`).
- **Zero Per-Ticket Hygiene Tax:** Do NOT run `orchestration-auditor` or full transcript mining on every ticket. Capture learnings on demand via `/learn` (or explicit user correction) and run `orchestration-auditor` + `OBSERVATIONS_FILE` triage on a weekly `/schedule`.

## 6. Pre-PR Closure & Dual-Environment Operations Gate

Before requesting commit/push permission or running `gh pr create`, complete ALL four checks:
1. **Upstream Rebase & In-Flight PR Scan:**
   - `git fetch origin main && git rev-list --count HEAD..origin/main`. If `> 0`, rebase on `origin/main` and re-run `pnpm pr-check` + E2E.
   - Run `gh pr list --state open`; inspect `gh pr diff <num>` on any PR touching shared files (`src/lib/billing/*`, `prisma/schema.prisma`) to prevent collisions.
2. **Local CI Gate:** Run `PR_CHECK_CMD` (`pnpm pr-check`: 0 lint errors/warnings, 0 `tsc` errors, 100% passing `pnpm test`).
3. **Production Data Integrity Check:** Confirm real DB models/constraints persist across page reload (`NODE_ENV === 'production'` path intact).
4. **Staging & Production Operations & Drift Report:** Run `DRIFT_REPORT_CMD` (`pnpm run drift-report`), enrich with exact Staging (Vercel / `.env.preview`) vs Production (VPS `.env`) retrieval/CLI commands, external service steps (Stripe, object storage, background queues, OAuth/DNS), and present directly in chat alongside both smoke check commands (`node scripts/smoke-test.mjs https://app.example.com` and `https://app.example.com`).
5. **Public `ZeroBurn` (`../zeroburn`) Sync Reminder:** Whenever a branch modifies any file under `.agents/**` (`git diff --name-only origin/main...HEAD -- .agents`), run `EXPORT_ORCHESTRATOR_CMD` (`node .agents/scripts/export-public-orchestrator.mjs ../zeroburn`) and explicitly remind the user to commit and push `../zeroburn`.
