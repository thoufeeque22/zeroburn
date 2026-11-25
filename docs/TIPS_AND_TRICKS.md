# ZeroBurn Tips, Tricks & Token Optimization Guide

> Practical techniques to minimize AI coding-agent context consumption, protect rolling 5-hour quota pools, streamline multi-slice epics, and accelerate delivery.

---

## 1. Session Hygiene & Minimalist Prompt Startups

### The Rule of Clean Sessions
Every interaction with an AI agent incurs context cost. In chat-based orchestrators (Antigravity, Claude Code, Cursor), **context is billed cumulatively on every single turn**:
- If a session has accumulated 50,000 tokens of test outputs, git diffs, and previous subagent transcripts, every subsequent turn, tool call, and internal thought phase re-bills that entire 50,000-token payload ($O(N^2)$ token explosion).
- **Best Practice:** Keep **one chat session per ticket / slice**. When a PR is open and you move to the next ticket, start a fresh conversation.

### 1-Line Deterministic Startups (Zero Handoff Overhead)
Never waste 1,000–3,000 tokens writing or pasting manual context handovers between sessions. The repository, git branch history, and issue tracker already hold 100% of the state.

**To start a ticket, literally just type:**
```text
start orchestration workflow on #1043
```
or with a full GitHub issue URL:
```text
start orchestration workflow on https://github.com/owner/repo/issues/1043
```

#### Why you do NOT need to specify the epic branch:
1. **GitHub Issue Metadata:** The issue description states its parent epic (e.g. `Parent Epic: #1038`).
2. **Deterministic Inspection in Stage 0:** In Stage 0, the orchestrator inspects the issue via `gh issue view` and runs `git branch -a | grep <epic-id>` to automatically locate the active epic branch (`epic/<epic-id>-<slug>`).
3. **Automatic Worktree / Branch Creation:** The orchestrator branches `feature/<slice-id>-<slug>` directly from `epic/<epic-id>-<slug>` without you needing to explain the topology.

### When to Use `/compact`
- If a ticket requires iterative bug-fixing or extended troubleshooting exceeding **15–20 tool turns**, trigger the `/compact` slash command.
- `/compact` condenses prior transcript logs and test dumps into a terse checkpoint artifact, immediately reclaiming 50–70% of your active context window.

---

## 2. Multi-Slice Epic Workflows (Master Epic Branches)

### The Stacking PR Anti-Pattern
In standard Git workflows, sub-tasks are often branched from one another:
`main` -> `feature/slice-1` -> `feature/slice-2` -> `feature/slice-3`.
If `slice-1` requires review feedback or changes, rebasing downstream branches causes painful cascade conflicts.

### The Master Epic Branch Protocol
ZeroBurn solves this using dedicated **Master Epic Branches** (`Track L`):
1. **Epic Branch Initialization:**
   ```bash
   git checkout -b epic/<epic-id>-<slug> origin/main
   git push -u origin epic/<epic-id>-<slug>
   ```
2. **Vertical Slice PRs:**
   Every sub-issue branches from and opens a PR targeting `epic/<epic-id>-<slug>`:
   ```bash
   git checkout -b feature/<slice-1>-<slug> epic/<epic-id>-<slug>
   gh pr create --base epic/<epic-id>-<slug>
   ```
3. **Atomic Merge to Main:**
   When all slices are merged into `epic/<epic-id>-<slug>`, the entire epic branch undergoes a final rebase and verification gate before merging into `main` in a single atomic release.

---

## 3. Quiet CLI Verification & Failure Summaries

### The 15,000-Token Test Log Disaster
A single failing `vitest` run or TypeScript check can dump 300–800 lines of call stacks, ANSI color codes, and module trees (~15,000 tokens) into context. When an agent attempts 3 iterations to fix a test, it consumes ~45,000 tokens solely on raw terminal logs.

### ZeroBurn `quiet-cli.mjs` Solution
Run all verification commands via the zero-noise wrapper:
```bash
node .agents/scripts/quiet-cli.mjs tsc
node .agents/scripts/quiet-cli.mjs lint
node .agents/scripts/quiet-cli.mjs unit
node .agents/scripts/quiet-cli.mjs pr-check
node .agents/scripts/quiet-cli.mjs api-map
node .agents/scripts/quiet-cli.mjs exec --query "error term" <cmd> [args...]
node .agents/scripts/quiet-cli.mjs search "error term" [--source <id>]
node .agents/scripts/quiet-cli.mjs stats
```
- **On Success:** Emits exactly 1 line (~15 tokens): `[quiet-cli] unit: PASS (Test Files 131 passed, Tests 902 passed)`.
- **On Failure:** Capped strictly at 35 lines. If failures exceed 12 lines, the local Ollama **Judgment Kernel** parses the trace in **0 cloud tokens** and outputs a 3-line root-cause diagnosis. Outputs `>=4 KB` are also indexed into a local `node:sqlite` FTS5 spillover store (`quiet-store.mjs`) so you can query specific error terms with `quiet-cli.mjs search` without dumping the full log.
- **Automatic Enforcement (`PreToolUse`):** `pre-tool-guard.mjs` automatically rewrites raw `vitest run`, `tsc --noEmit`, `eslint`, and `pnpm pr-check` calls into `quiet-cli.mjs`, and blocks unbounded `read_file` calls on source files `>24 KB` without `StartLine`/`EndLine` so agents use `codebase-memory-mcp` or targeted line ranges.
- **Live Telemetry:** Run `node .agents/scripts/quiet-cli.mjs stats` anytime to see cumulative bytes and estimated tokens kept out of context.

---

## 4. Local Ollama & Hybrid Quota Pool Protection

### 5-Hour Rolling vs 7-Day Weekly Reserves
Frontier models like `Claude Opus 5.5` or `Gemini 4 Argon` often operate on strict weekly reset quotas. Burning weekly tokens on syntax linting, line count audits, or boilerplate generation drains your coding capacity early in the week.

### The 3-Tier Execution Split:
1. **0 Tokens (Deterministic Python & AST):**
   - Modularity checks (`<= 100` or `<= 200` lines).
   - AST checks (`'use server'` line 1, explicit `any` prohibition).
   - Blast radius validation (`git diff --name-only` matching blueprint).
2. **0 Cloud Tokens (Local Ollama `127.0.0.1:11434`):**
   - First-pass git diff audits (`qwen2.5-coder:14b-custom` or `7b`).
   - Terminal failure summarization & Judgment Kernel.
   - Privacy-sensitive inspections (`.env*`, secrets, keys).
3. **Frontier Cloud Models (`flash` first, `pro` reserved):**
   - High-level architectural reasoning (`discovery-agent` on `pro` for auth/billing/schema).
   - Core implementation (`dev-agent` on `inherit`).
   - Consolidated audit (`audit-agent` on `flash` receiving pre-computed findings).

---

## 5. Incidental Observations vs Scope Creep

### The Blast-Radius Discipline
During development, agents frequently spot unrelated technical debt: an unhandled exception in an adjacent route, a missing type, or outdated copy in another component.
- **The Wrong Action:** Fixing unrelated issues inside the active PR. This bloats the blast radius, causes merge conflicts with concurrent branches, and breaks PR atomicity.
- **The ZeroBurn Protocol:** Append the debt to `.agents/incidental_observations.json` in a single tool turn:
  ```json
  {
    "id": "OBS-1795360001",
    "file": "src/app/api/upload/complete/route.ts:31",
    "observation": "Pre-existing error leak in complete route",
    "severity": "low"
  }
  ```
- **Triage:** When pending observations reach `>= 5` or at the end of an epic, run `node .agents/scripts/triage-observations.mjs` to batch-triage them into dedicated chore issues.

---

## 6. Docs-Only Zero-Test Fast-Path

When a commit touches **only** markdown documentation, internal orchestration rules, or static guides (`docs/**`, `*.md`, `.agents/**`) with zero application code (`src/**`) or schema (`prisma/**`) diffs:
- **Skip the test suites entirely** (`pnpm test`, Vitest, Playwright, E2E).
- Running a 2-minute Playwright suite on a typo fix in a README burns CI quotas, local battery, and developer attention with zero regression prevention value.
- The pre-PR gate will still run syntax/lint checks without triggering redundant test runners.

---

## 7. Knowledge Graph MCP vs Grep

Always prefer Codebase Knowledge Graph MCP tools (`codebase-memory-mcp`) over full-file reads or broad grepping:
1. `search_graph(query="...")`: Finds exact symbol coordinates in 1 turn.
2. `get_code_snippet(qualified_name="...")`: Reads only the target function/class instead of 500 lines of file context.
3. `trace_path(function_name="...", direction="inbound")`: Maps callers across the entire codebase with zero exploratory turns.

---

## 8. Stage 1 Smart Bypass & Work-Resume Gate (Skipping Product & Discovery)

Spawning `product-agent` and `discovery-agent` on every single ticket wastes cloud quota and adds 30–60s of latency when a ticket is already partially built or fully specified in GitHub. ZeroBurn enforces a deterministic **Stage 0/1 Smart Bypass Gate**:

1. **Already-In-Progress Branches ("Already Worked Upon" -> 0-Token Resume):**
   - If `feature/<id>-*` already has commits ahead of `<base>` (`main` or `epic/<epic-id>-*`), active working-tree diffs, or an existing `discovery_blueprint.md`, Stage 1 is bypassed completely (`already_worked_on=True`).
   - The orchestrator resumes directly at **Stage 2 (`Development`)**, **Stage 3 (`QA Verification`)**, or **Stage 4 (`Hybrid Audit`)** depending on what is already completed on the branch.
2. **Pre-Specced Tickets (`skip_discovery=True` -> 0 Cloud Tokens):**
   - **Track L Child Sub-Issues:** Already decomposed during the parent Epic's Discovery with an explicit file blast radius and vertical slice contract.
   - **Observation-Triage & Detailed Bug Tickets:** Issues generated from `.agents/incidental_observations.json` or detailed bug reports that already name the target `file:line` and fix contract.
   - The orchestrator synthesizes `discovery_blueprint.md` directly from the issue body + a 0-token `codebase-memory-mcp` `search_graph` pre-fetch without spawning `discovery-agent`.
3. **Selective `product-agent` Trigger (`skip_product=True` by default on non-UX-strategy work):**
   - `product-agent` is skipped in 0 tokens not only for `pure_backend=True`, but also for bug fixes, component refactors, performance/a11y fixes, Track L child sub-issues, and tickets whose UX copy and tier entitlements are already specified.
   - `product-agent` runs **only** when introducing net-new user-facing UX flows, ambiguous customer copy, or new tier/pricing rules.

---

## 9. Upgrades & Version Synchronization (1-Command In-Place Upgrade)

ZeroBurn provides automated upstream update detection and a 1-command upgrade workflow:

1. **Automatic In-Session Alert:**
   - Every time a session starts, `session-start.mjs` checks upstream GitHub releases in the background (cached for 24 hours).
   - If a newer release is found, the session context banner displays:
     ```text
     Workspace context: zeroburn=v2.6.0 [UPDATE_AVAILABLE: v2.7.0 -> run `node .agents/scripts/init.mjs --upgrade`], ...
     ```
2. **1-Command Upgrade:**
   - Run:
     ```bash
     node .agents/scripts/init.mjs --upgrade
     ```
   - This downloads the latest release tag from GitHub, updates the orchestration engine, rules, and subagents in `.agents/`, and migrates `.agents/project.config.json` while preserving all custom project names, paths, and local model configs.
