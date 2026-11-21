<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Global Management Policies

> Authoritative rules for Agy (Antigravity). `GEMINI.md` at repo root is deprecated.
> Standards live in single-source files: [VARIABLES.md](base/VARIABLES.md), [ORCHESTRATION.md](base/ORCHESTRATION.md), [CORE.md](base/CORE.md), [UI_UX.md](base/UI_UX.md), [PRODUCTION.md](base/PRODUCTION.md).

## Non-Negotiable Global Invariants

1. **Quality Over Speed & Zero-Test Docs Fast-Path:** Always implement the most durable, architectural, zero-tech-debt fix. Never ship shortcuts or band-aids. For pure documentation, orchestration rule, or markdown updates (`docs/**`, `*.md`, `.agents/**`), **skip all test suites entirely** (`pnpm test`, E2E, Vitest) — never waste execution time running tests when zero application code is touched.
2. **Strict Branding:** Always write `<your-brand-name>` (exact lowercase with dot), social handle `@<your-brand-handle>`, monogram `<monogram>`. Never capitalize or shorten to "Directly".
3. **Artifact-First & No `.agents/state/`:** All ticket artifacts and scratch files MUST use `write_file` in `<appDataDir>/brain/<conversation-id>/` (`ARTIFACT_DIR` / `SCRATCH_DIR`). Never write `BRIEFING.md`, `progress.md`, `handoff.md`, or `.agents/state/` files. Never destructively overwrite artifacts.
4. **Branching, Worktree Isolation & Commit Safety:**
   - **Track S / Track M:** Work exclusively on `feature/<id>-<description>` (or `chore/<description>` for internal orchestration). Use an isolated `git worktree` from `main` when the current branch has active WIP. Never push or merge directly to `main`. Never commit without explicit user permission.
   - **Track L (Multi-Slice Epics):** Use an **Epic Feature Branch** (`epic/<epic-id>-<slug>`) branched from `main`. Slices (`feature/<slice-id>-...`) branch from and open PRs targeting `epic/<epic-id>-<slug>`. When all slices pass their verification gates and audits, `epic/<epic-id>-<slug>` is rebased on `main` and merged via a final single atomic PR. This eliminates deep PR stacking dependencies across sub-tasks.
5. **Dev Server Non-Interference:** Never kill or restart any server already running on port 3000 (or any active port). If occupied, start a background daemon (`IsDaemon: true`, `pnpm next dev -p <port>`), target it via `PLAYWRIGHT_TEST_BASE_URL=http://localhost:<port>`, and report the port to the user.
6. **Production Data Integrity:** Dev/test mocks for external services (Stripe, S3/R2, queue workers, OAuth/social APIs) are permitted when `NODE_ENV !== 'production'` or `process.env.E2E_TEST_MODE === 'true'`. Production code paths MUST persist real data to real DB models and satisfy all schema constraints.
7. **Tier Entitlement & Server-Side Gating:** Every feature must define and enforce `<your-brand-name>` subscription tiers (`FREE`, `PRO`, `TEAM`, `ENTERPRISE`). Enforce access server-side via `getUserTier(userId)` and `TIER_QUOTA_MAP` (`src/lib/billing/*`); render customer-facing tier labels strictly in human-readable form (`Free`, `Developer`, `Pro`, `Team`, `Enterprise` via `formatTierName()`, never raw DB enum strings) per [UI_UX.md](base/UI_UX.md). Client-only gating is forbidden.
8. **Evergreen In-App AI Knowledge:** Any change to user-facing features, routes, storage, social integrations, pricing, quotas, or settings MUST update `docs/` (`index.ts` aliases + `src/__tests__/unit/docs-knowledge.test.ts`).
9. **Proactive Product & Growth Mindset:** Proactively suggest conversion/retention optimizations (e.g., clear value comparisons, transparent upgrade paths) and clear UX improvements without waiting to be asked.
10. **Track Triage & Epic Sub-Issue Decomposition:**
    - **Track S / M (≤ 8–10 files, 1 PR):** Do NOT create GitHub sub-issues; keep fine-grained checklists in `ARTIFACT_DIR/plan.md`.
    - **Track L (Epic: > 2 phases or > 10 files):** At the end of `Discovery` (BEFORE coding), split into 2–4 vertical, independently mergeable **Native GitHub Sub-Issues** (`scripts/link-gh-subissue.sh`), each with its own blast radius, verification gate, and PR.
    - **Strict Track L Decomposition Rule:** Any ticket OR epic sub-issue projected to exceed **12–15 files** MUST be decomposed into smaller vertical, independently mergeable sub-issues during Discovery BEFORE Dev begins.
    - **Mid-Coding Escape Hatch:** Only split during `Development` if blast radius expands > 30% or hits an unrelated prerequisite refactor -> spawn 1 linked sub-issue so the current PR stays small.
11. **Stage 4 Audit Cap & Severity Blocking Policy:**
    - **Hard Cap of 2 Audit Rounds:** Stage 4 (`Audit`) is capped at a **MAXIMUM of 2 rounds**. Round 1 evaluates the full diff; Round 2 evaluates **ONLY the remediation delta** against `previous_ref` (never the full diff). If `Critical`/`High` issues persist after Round 2, escalate to human decision instead of looping.
    - **Severity Blocking Policy:** Only `Critical` and `High` security or data-integrity vulnerabilities can block PR progress (`FAIL`). `Medium`, `Low`, style, and lint nits MUST be logged to `.agents/incidental_observations.json` and deferred — never block PR closure.

## Subagent Registry & Model Routing

Subagents are natively auto-registered via the workspace plugin at `.agents/plugins/zeroburn/agents/` (no manual `define_subagent` needed). Orchestrator invokes them directly by name via `invoke_subagent`, `run_workflow(type_name="...")`, or `swarm` (Track L), passing the designated `Model` tier automatically. For UI spot-checks mid-Dev, invoke the built-in `browser` subagent (`Model="flash"`) and check `agentation` MCP annotations.

| Role | Agent File | Model Tier | Write Scope | Required Skills / MCP |
| :--- | :--- | :--- | :--- | :--- |
| Product | `product-agent.md` | `flash` (`pro` for pricing; 0-token skip on pure backend) | `ARTIFACT_DIR` only | `search_web` |
| Discovery | `discovery-agent.md` | `flash` (Track M) / `pro` (Track L or auth/billing/schema/AI) | `ARTIFACT_DIR` only | `codebase-memory-mcp` (`search_graph`, `trace_path`, `query_graph`) |
| Dev | `dev-agent.md` | `inherit` (M) / `pro` (L) / `cavecrew-builder` (S) | `src/`, `prisma/`, `ARTIFACT_DIR` | `architect` (Track L only), `triage-lint` |
| QA | `qa-agent.md` | `flash` (`pro` for complex auth/tier) | `src/__tests__/`, `.maestro/`, `docs/manual_tests/`, `ARTIFACT_DIR` | Playwright, `@axe-core/playwright`, Maestro |
| Audit | `audit-agent.md` | 0-token Python + local Ollama `qwen2.5-coder:14b-custom` + 1 cloud auditor (`flash` Track M / `pro` high-risk or Track L) | `ARTIFACT_DIR` only (READ-ONLY on `src/`) | `local-ollama-bridge`, `modern-web-guidance`, `gemini-cli-security` (`analyze`) |
| Doc | `doc-agent.md` | `flash` | `docs/`, `README.md`, `.agents/`, `ARTIFACT_DIR` | `pnpm pr-check`, `pnpm run drift-report` |
| Project | `project-agent.md` | `flash` | `ARTIFACT_DIR`, `.agents/incidental_observations.json` | `gh-project-issue-manager`, `gh` CLI (`run_command`) |
| System | `system-agent.md` | `pro` | `AGENTS.md`, `.agents/` | `orchestration-auditor` |
