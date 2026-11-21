# ZeroBurn (`zeroburn`)

> **Cut AI coding-agent token & quota burn by 70–83%** with 0-token static & blast-radius checks, dynamic local Ollama diff review + Judgment Kernel failure digests, code-graph pre-fetching, parallel swarm file leases, and 1-line test receipts — without sacrificing Contract-First TDD or strict quality gates.
>
> *Engineered by the team building **[directly.social](https://directly.social)** (`@directlysocial`).*

---

## Why `zeroburn` Exists

Most multi-agent setups ("PM / Architect / Dev / QA prompt packs") drain your 5-hour and weekly Claude / Gemini usage limits in two tickets because:
1. **Blank-Slate Subagent Tax:** Every subagent starts fresh and wastes 3–5 turns re-reading markdown rule files, directory trees, and full source files.
2. **Test Log Bloat:** Verbose test/lint runs (`vitest`, `eslint`, `tsc`) dump 500+ lines (~15,000 tokens) into context on every turn, which then gets re-billed on every subsequent turn ($O(N^2)$ context growth).
3. **Frontier Models on Mechanical Checks:** Cloud `pro` / `Opus` models are spawned to check line counts, `any` types, and file blast radius that Python + local Ollama can verify in **0 cloud tokens**.

### Token & Quota Benchmark (Per Feature Ticket)

| Metric | Standard Multi-Agent Pipeline | `zeroburn` v2.3.0 Engine | Savings |
| :--- | :--- | :--- | :--- |
| Cloud `pro` Subagent Sessions | 6–9 sessions | **0–1 session** (`flash` default) | **~85% fewer `pro` calls** |
| Exploratory File-Read Turns | 12–18 turns | **0–2 turns** (0-token Graph Pre-Fetch + `REPO_MAP_DIGEST`) | **~80% fewer turns** |
| Test / Lint Log Context Cost | ~15,000 tokens / run | **~15 tokens / run** (`quiet-cli.mjs` + Judgment Kernel) | **99.9% log reduction** |
| Diff & Modularity Audit | 3 parallel cloud subagents | **0-token Python AST/Blast-Radius + Local Ollama + 1 Cloud Auditor** | **~70% stage savings** |

---

## How It Works (Zero-Waste Harness Mechanisms)

1. **Single Declarative Config & Dynamic Local Model Resolution (`.agents/project.config.json`):** Set `"localCoderModel": "auto"` and `"localProseModel": "auto"` to automatically detect and use whichever coder (`qwen*-coder`, `deepseek-coder`, `codellama`, `starcoder`) and prose (`gemma*`, `llama*`, `mistral*`, `phi*`) models are installed in local Ollama — or pin specific tags per repo.
2. **Auto-Start & Fail-Closed Local Ollama Gate (`session-start.mjs` & `workflow_common.py`):**
   - Automatically starts `ollama serve` in the background if `127.0.0.1:11434` is down, dynamically resolves installed models from `/api/tags`, and hard-stops workflows only if no local model is reachable.
3. **0-Token Knowledge Graph Pre-Fetch (`codebase-memory-mcp`):**
   - Pre-fetches top symbol coordinates (`file:start-end`) before Discovery and 2-hop impacted call-graph nodes (`detect_changes`) before Audit in **0 LLM tokens**.
4. **Inlined Rule Digests & Dynamic `REPO_MAP_DIGEST`:**
   - Pre-computes Prisma models, `src/lib/*` domains, Server Actions, and `/api/**` endpoints in `<5ms` Python and inlines compressed rule digests so subagents never waste turns calling `read_file` on markdown docs.
5. **Pool-Safe `FALLBACK_CHAINS` & `<= 4` Handoff Cap:**
   - Steps down through cheaper 5-hour tiers (`pro -> flash -> flash_lite -> inherit`) before touching `inherit`, protecting weekly reserve model pools while keeping Track M pipelines under the 4-handoff cliff.
6. **Quiet CLI Verification + Local Ollama Judgment Kernel (`node .agents/scripts/quiet-cli.mjs <tsc|lint|unit|pr-check|api-map>`):**
   - Emits 1-line receipts (`[quiet-cli] unit: PASS`) on green runs, summarizes >12-line failures via local Ollama in 0 cloud tokens, and introspects `/api/**` routes via `api-map`.
7. **Deterministic Blast-Radius Drift Guard & Parallel Swarm File Leases:**
   - `parallel-audit.py` deterministically verifies `git diff --name-only` against the Discovery blueprint in 0 tokens, and `workflow_common.py` + `pre-tool-guard.mjs` enforce exclusive file-path leases (`.agents/swarm_leases.json`) across parallel swarm workers.

---

## Repository Layout

```text
CHANGELOG.md                        # Version history & upgrade notes
.agents/
├── AGENTS.md                       # Global management policies & Subagent Registry
├── project.config.json             # Single declarative config (stamps zeroburnVersion)
├── project.config.example.json     # Starter template
├── hooks.json                      # SessionStart & PreToolUse safety hooks
├── base/
│   ├── ORCHESTRATION.md            # Hybrid Quota Policy (Options A+B+C), Tracks S/M/L
│   ├── CORE.md                     # TypeScript, 100-line modularity, data contracts
│   ├── PRODUCTION.md               # Reliability, 7-Point AI Security Checklist
│   ├── UI_UX.md                    # Design system, ergonomics, a11y, microcopy
│   └── VARIABLES.md                # Canonical paths, commands, verdicts
├── hooks/
│   ├── session-start.mjs           # Git + Version + Auto-Start Local Ollama + Graph banner
│   └── pre-tool-guard.mjs          # Secret guard, Swarm file-lease guard, 100-line guard
├── scripts/
│   ├── init.mjs                    # 1-command auto-detector & version upgrader (--pull, --pin, --version)
│   ├── workflow_common.py          # Shared FALLBACK_CHAINS, dynamic Ollama resolution, Graph pre-fetch, Swarm leases
│   ├── parallel-discovery.py       # Stage 1: Product || Discovery workflow
│   ├── parallel-audit.py           # Stage 4: 0-token Python/Blast-Radius + Local Ollama + 1 Cloud Auditor
│   └── quiet-cli.mjs               # 1-line tsc/lint/vitest wrapper + Judgment Kernel + api-map
└── plugins/
    └── zeroburn/
        ├── plugin.json             # Single source of truth for ZeroBurn version (v2.3.0)
        └── agents/                 # 8 specialized subagent definitions
```

---

## Quick Start (1 Command)

Copy `.agents/` into your repository root and run the auto-initializer:

```bash
node .agents/scripts/init.mjs --pull
```

What `init.mjs` does automatically:
1. **Auto-Detects Your Stack & Paths:** Scans `package.json`, `tsconfig.json`, `prisma/schema.prisma`, `src/lib`, and `src/app/actions` to populate `.agents/project.config.json`.
2. **Dynamic Local Model Resolution (`"auto"`):** Queries local Ollama (`/api/tags`) and uses any coder/prose models you **already have installed** with zero config edits.
3. **Hardware-Aware Auto-Pull (`--pull`):** Only if no suitable local model is installed yet, detects your machine's RAM (`<24GB` -> `7b`, `>=24GB` -> `14b`) and pulls the right model automatically (pass `--pin` to lock exact tags).
4. **Zero-Noise Verification:** Run `node .agents/scripts/quiet-cli.mjs pr-check` for 1-line agent verification receipts.

---

## Attribution

Open-sourced by the engineering team building **[directly.social](https://directly.social)** (`@directlysocial`).
