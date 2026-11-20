# Orchestration & Workflow Variables

Single source of truth for identifiers, tracks, phases, verdicts, paths, and commands.

## Git & Branching
- `MAIN_BRANCH`: `main`
- `FEATURE_BRANCH_PATTERN`: `feature/<id>-<description>`
- `COMMIT_MSG_PATTERN`: `<type>(ticket-<id>): <summary>`

## State & Artifacts
- `ARTIFACT_DIR`: `<appDataDir>/brain/<conversation-id>/`
- `SCRATCH_DIR`: `<appDataDir>/brain/<conversation-id>/scratch/`
- `SCREENSHOT_DIR`: `<appDataDir>/brain/<conversation-id>/screenshots/`
- `TRANSCRIPT_PATH`: `<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`
- `OBSERVATIONS_FILE`: `.agents/incidental_observations.json`

## Pipeline Sequence (`PHASE_ORDER`)
- **Track S (Quick Fix / Chore, ≤ 3 files, no schema/tier/security/UI-arch change):** `0. Branch Init & Triage -> Dev -> Fast Verify -> PR`
- **Track M/L (Standard Feature or Complex Epic):**
  0. `Branch Init & Triage` (Orchestrator + `project-agent` if no issue)
  1. `Product || Discovery` (`product-agent` + `discovery-agent` -> Unified Blueprint + QA Acceptance Contract & `data-testid` spec; Track L proposes 2–4 Epic Sub-Issues)
  2. `Development` (`dev-agent` — Contract-First Unit Tests + Implementation + `browser` UI spot-check)
  3. `QA` (`qa-agent` — Playwright E2E against live `data-testid`s + Light/Dark/375px `visual_testing_evidence.md`)
  4. `Audit` (`audit-agent` / `PARALLEL_AUDIT_WORKFLOW` — Read-Only Security, Blast Radius, UX & Web Vitals)
  5. `Visual Sign-Off` (Human Gate #2 — present compiled `visual_testing_evidence.md`)
  6. `Documentation` (`doc-agent` — Docs, `pnpm pr-check`, Rebase/PR Scan & `DRIFT_REPORT_CMD`)
- **Orthogonal:** `Project` (`project-agent` — Issue creation, Native Sub-Issue linking, Incidental Observations)

## Canonical Verdicts (`VERDICT`)
- `Product` / `Discovery`: `APPROVED` | `NEEDS-INFO` | `REJECTED`
- `Development`: `SUCCESS` | `BLOCKED`
- `QA`: `PASS` | `FAIL`
- `Audit`: `PASS` | `FAIL`
- `Documentation`: `COMPLETE` | `BLOCKED`
- `Project`: `ISSUES_MANAGED` | `BLOCKED`

## Scripts & Commands
- `INIT_CMD`: `node .agents/scripts/init.mjs` (`--pull` to auto-pull hardware-matched local Ollama models; `--pin` to pin resolved tags in `.agents/project.config.json`)
- `QUIET_CLI_CMD`: `node .agents/scripts/quiet-cli.mjs` (`tsc` | `lint` | `unit` | `pr-check` — 1-line summary on pass, 35-line cap on fail)
- `LINT_CMD`: `pnpm lint`
- `TYPE_CHECK_CMD`: `npx tsc --noEmit`
- `UNIT_TEST_CMD`: `pnpm test`
- `BUILD_CMD`: `pnpm build`
- `PR_CHECK_CMD`: `pnpm pr-check` (`lint` + `tsc --noEmit` + `pnpm test`)
- `DRIFT_REPORT_CMD`: `pnpm run drift-report`
- `SMOKE_TEST_CMD`: `pnpm run test:smoke`
- `REGRESSION_TEST_CMD`: `pnpm run test:regression`
- `NATIVE_TEST_CMD`: `pnpm run test:native`
- `NATIVE_FULL_CMD`: `pnpm run test:native:full`
- `NOTEBOOK_BUNDLE_CMD`: `pnpm run notebook:package`
- `VPS_DEPLOY_CMD`: `pnpm run deploy:vps`
- `SUBISSUE_LINK_SCRIPT`: `./scripts/link-gh-subissue.sh`

## Workflow Scripts, Graph & Test Paths
- `PROJECT_CONFIG_FILE`: `.agents/project.config.json` *(portable repo configuration; template at `.agents/project.config.example.json`)*
- `EXPORT_ORCHESTRATOR_CMD`: `node .agents/scripts/export-public-orchestrator.mjs <target-dir>`
- `GRAPH_PROJECT_ID`: `<your-graph-project-id>`
- `WORKFLOW_COMMON_SCRIPT`: `.agents/scripts/workflow_common.py`
- `PARALLEL_DISCOVERY_WORKFLOW`: `.agents/scripts/parallel-discovery.py`
- `PARALLEL_AUDIT_WORKFLOW`: `.agents/scripts/parallel-audit.py`
- `E2E_TEST_FILE_PATTERN`: `src/__tests__/e2e/<feature-name>.spec.ts` *(never put ticket ID in filename; put it in `test.describe`)*
- `MANUAL_TEST_FILE_PATTERN`: `docs/manual_tests/<feature-area>.md` *(living feature runbook ONLY when flows cannot be automated by Playwright; never create per-ticket files)*
- `AI_KNOWLEDGE_DIR`: `docs/`
- `RATE_LIMIT_REGISTRY`: `src/lib/core/rate-limit-registry.ts`

## Application Source-of-Truth Modules
- `BRAND_CONFIG`: `src/lib/core/brand.ts`
- `EMAIL_CONFIG`: `src/lib/core/emails.ts`
- `APP_CONFIG`: `src/lib/core/config.ts`
- `APP_CONSTANTS`: `src/lib/core/constants.ts` *(includes `PLATFORMS`, quotas, admin config)*
- `PRODUCT_DATA`: `src/lib/core/product-data.ts`
- `TIER_CONFIG`: `src/lib/billing/*`
- `ADMIN_AUTH`: `src/lib/auth/admin.ts` *(reads super-admin allowlist from `APP_CONSTANTS` / env; never hardcode personal emails in `.agents/`)*

## Skills
- `ARCHITECT_SKILL`: `architect`
- `MODERN_WEB_SKILL`: `modern-web-guidance`
- `SECURITY_ANALYZE_SKILL`: `analyze`
- `AUDITOR_SKILL`: `orchestration-auditor`
- `GH_ISSUE_MANAGER_SKILL`: `gh-project-issue-manager`
- `TRIAGE_LINT_SKILL`: `triage-lint`
