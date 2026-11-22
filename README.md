# ZeroBurn (`zeroburn`)

> **Cut AI coding-agent cloud API token & quota burn by 70–83%** by eliminating test/discovery output bloat, querying local code graphs, running deterministic AST/scope checks, and offloading mechanical failure analysis and diff reviews to local Ollama models — without sacrificing Contract-First TDD or strict quality gates.
>
> *Engineered by the team building **[directly.social](https://directly.social)** (`@directlysocial`).*

## ⚡ Quick Start & Live Demo (10 Seconds)

**Option A — Try it live in your own repo right now (Zero Install):**
Paste this inside **any Git repository** on your machine to see your exact discovery token savings and run a real-time **0-cloud-token Static AST + Local Ollama Diff Audit** on your current `git diff`:

```bash
curl -fsSL https://github.com/thoufeeque22/zeroburn/raw/main/benchmarks/try-now.mjs \
  | node
```

**Option B — Install ZeroBurn into your project (1 Command):**
Clones `.agents/`, auto-detects your stack (`Next.js`, `TypeScript`, `Prisma`), dynamically resolves your installed local Ollama models (`"auto"`), pulls a hardware-sized local model if none is installed (`<24GB` RAM -> `7b`, `>=24GB` -> `14b`), and configures 1-line `quiet-cli` verification:

```bash
git clone --depth 1 https://github.com/thoufeeque22/zeroburn /tmp/zb \
  && cp -R /tmp/zb/.agents . && rm -rf /tmp/zb \
  && node .agents/scripts/init.mjs --pull
```

![ZeroBurn Live Benchmark & 0-Token Diff Auditor](benchmarks/zeroburn-benchmark.png)

<details>
<summary><b>View raw ASCII tabular output from a 1,465-file repository</b></summary>

```text
🔥 ZeroBurn v2.6.0 — Live Token-Savings Benchmark & 0-Token Diff Auditor
📂 Repository: /Users/dev/my-app (branch: feat/billing-quota)

📊 1. Context & Cloud Token Footprint (Standard Subagent vs ZeroBurn)
┌────────────────────────────┬────────────────────────────┬─────────────────────────────┬────────────────┐
│ Pipeline Stage             │ Vanilla Agent              │ ZeroBurn v2.6.0             │ Cloud Saved    │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼────────────────┤
│ 1. Repo & Route Discovery  │ 15,429 tok (1465 files)    │ 512 tok (5-line digest)     │ -96.7%         │
│ 2. Rule & Docs Ingestion   │ 59,202 tok (4348 lines)    │ 195 tok (7-line digest)     │ -99.7%         │
│ 3. Test Verification Logs  │ 6,816 tok (verbose log)    │ 17 tok (1-line quiet-cli)   │ -99.8%         │
│ 4. Diff Security Audit     │ 3,500 tok (Cloud Pro)      │ 0 tok (Local Ollama + AST)  │ -100.0%        │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼────────────────┤
│ TOTAL (Single Agent Loop)  │ 84,947 cloud tokens        │ 724 cloud tokens            │ -99.1%         │
│ 5-TURN CUMULATIVE BILLING  │ ~339,788 billed tokens     │ ~2,896 billed tokens        │ 336,892 saved  │
└────────────────────────────┴────────────────────────────┴─────────────────────────────┴────────────────┘

🛡️  2. Live 0-Cloud-Token Diff Audit (HEAD~1..HEAD — 3 changed file(s))
┌────────────────────────────┬──────────┬──────────────┬─────────────────────────────────────────────────┐
│ Audit Engine               │ Time     │ Cloud Cost   │ Verdict                                         │
├────────────────────────────┼──────────┼──────────────┼─────────────────────────────────────────────────┤
│ Static AST & Modularity    │ 0.01s    │ 0 cloud tok  │ ✅ PASS (<=200L, 0 `any`, line-1 actions)        │
│ Ollama (qwen2.5-coder:14b) │ 8.92s    │ 0 cloud tok  │ ✅ PASS — Clean diff verified                    │
└────────────────────────────┴──────────┴──────────────┴─────────────────────────────────────────────────┘
```
</details>

---

## Why `zeroburn` Exists

Most multi-agent setups ("PM / Architect / Dev / QA prompt packs") drain your 5-hour and weekly Claude / Gemini usage limits in two tickets because:
1. **Blank-Slate Subagent Tax:** Every subagent starts fresh and wastes 3–5 turns re-reading markdown rule files, directory trees, and full source files.
2. **Test Log Bloat:** Verbose test/lint runs (`vitest`, `eslint`, `tsc`) dump 500+ lines (~15,000 tokens) into context on every turn, which then gets re-billed on every subsequent turn ($O(N^2)$ context growth).
3. **Frontier Models on Mechanical Checks:** Cloud `pro` / `Opus` models are spawned to check line counts, `any` types, and file blast radius that Python + local Ollama can verify in **0 cloud tokens**.

### Verified Production Benchmark (`directly.social` — 10,893 AST Nodes, 1,470 Source Files)

Measured on a real feature/audit loop (*"Locate and audit `checkUploadQuota` tier logic, run all 6 billing unit test suites (70 tests), and execute a diff security audit"*). Full raw traces and reproducible runner in [`benchmarks/REAL_WORLD_BENCHMARK.md`](benchmarks/REAL_WORLD_BENCHMARK.md):

> **Note on Token Accounting:** "Cloud Tokens" refers strictly to billed API tokens sent to frontier LLM APIs (e.g. Claude/Gemini). Mechanical tasks (first-pass diff review, failure log triage) are offloaded to an on-device local Ollama instance (`127.0.0.1:11434`), reducing billed cloud API tokens by 98.2% without skipping verification gates.

| Stage | Standard Coding Agent (Vanilla) | `zeroburn` v2.6.0 Engine | Measured Savings |
| :--- | :--- | :--- | :--- |
| **1. Repo & Route Discovery** | `find src -type f` (`1,470` lines / **15,454 tokens**) | `build_repo_map_digest()` (`6` lines / **636 tokens**: 28 Prisma models, 32 domains, 60 API routes) | **-95.9% tokens** |
| **2. Governance & Rule Loading** | `cat .agents/AGENTS.md .agents/base/*.md` (`276` lines / **10,274 tokens**) | Pre-computed inlined rule digests (`7` lines / **195 tokens**) | **-98.1% tokens** |
| **3. Symbol Localization** | `grep -rn "quota" src/lib/` (`64` matches / **1,921 tokens**) + exploratory reads | `codebase-memory-mcp` `search_graph` -> `FreemiumGuard.checkUploadQuota` (`src/lib/billing/freemium-guard.ts:43-83`) in **0 LLM tokens** | **-100% exploratory LLM tokens** |
| **4. Unit Test Run (6 suites, 70 tests)** | `npx vitest run` (`243` lines / **6,816 tokens** per run) | `node .agents/scripts/quiet-cli.mjs unit` (`1` line / **17 tokens**) | **-99.75% test log tokens** |
| **5. Diff Security & Quality Audit** | Cloud `Pro` / `Opus` subagent review (**~12,000+ cloud tokens**) | 0-token Python AST/Blast-Radius + Local Ollama `qwen2.5-coder:14b-custom` (`13.43s`, **0 cloud tokens**) | **100% cloud audit quota saved** |
| **Single-Pass Overhead Total** | **46,465+ Cloud Tokens** | **848 Cloud Tokens** | **98.2% Reduction** |

#### ⚡ 30-Second Before vs After (Actual Terminal Trace)

```text
❌ WITHOUT ZEROBURN (Standard Subagent — 46,465 tokens burned before writing code):
$ find src -type f                                  # 1,470 lines  (15,454 tokens)
$ cat .agents/AGENTS.md .agents/base/*.md           #   276 lines  (10,274 tokens)
$ grep -rn "quota" src/lib/                         #    64 lines  ( 1,921 tokens)
$ npx vitest run src/__tests__/unit/*billing*       #   243 lines  ( 6,816 tokens)
$ [Spawns Cloud Pro Subagent for Diff Review]       #              (12,000 tokens)
----------------------------------------------------------------------------------
💥 Result: 46,465+ tokens & ~185,000 cumulative billed tokens across a 5-turn loop.

✅ WITH ZEROBURN v2.6.0 (848 tokens — 98.2% reduction):
$ [codebase-memory-mcp] search_graph("billing tier quota check")   #     0 tokens
  -> FreemiumGuard.checkUploadQuota (src/lib/billing/freemium-guard.ts:43-83)
$ [Inlined REPO_MAP_DIGEST + Rule Digests]                         #   831 tokens
  -> 28 Prisma Models | 32 src/lib domains | 60 API Routes
$ node .agents/scripts/quiet-cli.mjs unit src/__tests__/unit/*billing*
  -> [quiet-cli] unit: PASS (Test Files 6 passed (6), Tests 70 passed (70)) # 17 tokens
$ [parallel-audit.py] Python AST + Local Ollama qwen2.5-coder      #     0 cloud tokens
----------------------------------------------------------------------------------
⚡ Result: 848 tokens total. Surgical edit on Turn 1. Zero cloud Pro audit burn.
```

---

## How It Works (Under the Hood)

Instead of relying on proprietary agent runtimes or fuzzy prompts, ZeroBurn is a set of transparent scripts, hooks, and local model helpers that stop agents from burning cloud context on mechanical noise:

1. **Test Stdout Truncation & Local Failure Diagnosis (`quiet-cli.mjs`):**
   - **Passing runs:** Vitest, ESLint, and TypeScript emit a clean 1-line receipt (`PASS`) instead of dumping 500 lines of ASCII progress bars into chat history.
   - **Failing runs ("Judgment Kernel"):** On complex failures (>12 lines), a local Ollama model (`gemma4` or `qwen2.5-coder`) inspects stderr and outputs a concise 3-line diagnostic (exact `file:line`, root cause, suggested fix) directly *above* the last 35 lines of the raw compiler/test stack trace. Critical diagnostic lines are never dropped.

2. **Pre-Execution AST Code Graph (`codebase-memory-mcp`):**
   - Queries a local SQLite/AST symbol index before constructing subagent prompts. Resolves exact file coordinates (`file:line-range`) and 2-hop dependency trees in **0 cloud tokens**, stopping agents from running expensive directory scans (`find src`) or brute-force regex grepping.

3. **Two-Tier Hybrid Security & Quality Audit (`parallel-audit.py`):**
   - **Tier 1 (Local AST + Ollama Pre-Filter):** Runs zero-cloud-token Python checks (line count modularity, `'use server'` positioning, explicit `any`) and a local Ollama diff scan.
   - **Tier 2 (Cloud Auditor Final Decision):** Local findings are passed into a single cloud frontier auditor (`pro` or `flash`), which filters out local model noise/false positives and serves as the authoritative gate for blocking `Critical` and `High` issues.

4. **Blueprint Scope Verification ("Blast-Radius Guard"):**
   - A deterministic Python check comparing `git diff --name-only` against the files planned during ticket discovery. Silently modified files outside the agreed scope are flagged immediately in 0 LLM tokens.

5. **Advisory File Locks for Parallel Workers (`swarm_leases.json`):**
   - Simple JSON lockfile enforced by `pre-tool-guard.mjs` before file edits, preventing concurrent subagents in multi-agent swarms from modifying the same file at the same time and creating conflict loops.

6. **Inlined Rule & Route Digests (`REPO_MAP_DIGEST`):**
   - Pre-computes routes and Prisma models into a 6-line digest so subagents don't waste initial turns reading markdown documentation files.

7. **Multi-Slice Epic Feature Branches:**
   - Multi-slice epics branch into and PR against dedicated `epic/<epic-id>-<slug>` feature branches to eliminate cascading rebase conflicts. Commits touching only docs or markdown rules bypass full test suites to save developer and CI compute.

---

## Tips, Tricks & Token Optimization Guide

For everyday efficiency tips, prompt shortcuts, and session hygiene best practices, read the [**ZeroBurn Tips & Tricks Guide**](docs/TIPS_AND_TRICKS.md):
- **1-Line Minimalist Startups:** Why typing `start orchestration workflow on #1043` is faster and cheaper than pasting 2,000-token manual handover notes.
- **Master Epic Branches:** Eliminating cascading rebase conflicts on multi-slice features.
- **Session Lifecycles:** 1 chat per ticket, 0-token AST checks, and optimal timing for `/compact`.
- **Knowledge Graph vs Grep:** Using MCP graph queries instead of reading full 500-line source files.

---

## Repository Layout

```text
CHANGELOG.md                        # Version history & upgrade notes
docs/
└── TIPS_AND_TRICKS.md              # Operational token-saving & prompt shortcut guide
benchmarks/
├── REAL_WORLD_BENCHMARK.md         # Verified A/B benchmark on 10,893-node production repo
├── try-now.mjs                     # Zero-install live token benchmark & local Ollama diff auditor
└── run_benchmark.py                # Reproducible Python A/B benchmark runner
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
│   ├── live-audit.mjs              # Real-time 0-cloud-token diff auditor & context calculator
│   ├── workflow_common.py          # Shared FALLBACK_CHAINS, dynamic Ollama resolution, Graph pre-fetch, Swarm leases
│   ├── parallel-discovery.py       # Stage 1: Product || Discovery workflow
│   ├── parallel-audit.py           # Stage 4: 0-token Python/Blast-Radius + Local Ollama + 1 Cloud Auditor
│   └── quiet-cli.mjs               # 1-line tsc/lint/vitest wrapper + Judgment Kernel + api-map
└── plugins/
    └── zeroburn/
        ├── plugin.json             # Single source of truth for ZeroBurn version (v2.6.0)
        └── agents/                 # 8 specialized subagent definitions
```

---

## Attribution

Open-sourced by the engineering team building **[directly.social](https://directly.social)** (`@directlysocial`).
