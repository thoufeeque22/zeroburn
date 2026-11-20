# ZeroBurn (`zeroburn`)

> **Cut AI coding-agent token & quota burn by 70–83%** with 0-token static checks, local Ollama diff review, code-graph pre-fetching, and 1-line test receipts — without sacrificing Contract-First TDD or strict quality gates.
>
> *Engineered by the team building **[directly.social](https://directly.social)** (`@directlysocial`).*

---

## Why `zeroburn` Exists

Most multi-agent setups ("PM / Architect / Dev / QA prompt packs") drain your 5-hour and weekly Claude / Gemini usage limits in two tickets because:
1. **Blank-Slate Subagent Tax:** Every subagent starts fresh and wastes 3–5 turns re-reading markdown rule files, directory trees, and full source files.
2. **Test Log Bloat:** Verbose test/lint runs (`vitest`, `eslint`, `tsc`) dump 500+ lines (~15,000 tokens) into context on every turn, which then gets re-billed on every subsequent turn ($O(N^2)$ context growth).
3. **Frontier Models on Mechanical Checks:** Cloud `pro` / `Opus` models are spawned to check line counts, `any` types, and file blast radius that Python + local Ollama can verify in **0 cloud tokens**.

### Token & Quota Benchmark (Per Feature Ticket)

| Metric | Standard Multi-Agent Pipeline | `zeroburn` Hybrid Engine | Savings |
| :--- | :--- | :--- | :--- |
| Cloud `pro` Subagent Sessions | 6–9 sessions | **0–1 session** (`flash` default) | **~85% fewer `pro` calls** |
| Exploratory File-Read Turns | 12–18 turns | **0–2 turns** (0-token Graph Pre-Fetch + `REPO_MAP_DIGEST`) | **~80% fewer turns** |
| Test / Lint Log Context Cost | ~15,000 tokens / run | **~15 tokens / run** (`quiet-cli.mjs`) | **99.9% log reduction** |
| Diff & Modularity Audit | 3 parallel cloud subagents | **0-token Python AST + Local Ollama + 1 Consolidated Cloud Auditor** | **~70% stage savings** |

---

## How It Works (7 Zero-Waste Mechanisms)

1. **Single Declarative Config (`.agents/project.config.json`):** Configure your stack, local Ollama models (`qwen2.5-coder`, `gemma4`), high-risk paths, and modularity limits in one JSON file.
2. **Auto-Start & Fail-Closed Local Ollama Gate (`session-start.mjs` & `workflow_common.py`):**
   - Automatically starts `ollama serve` in the background if `127.0.0.1:11434` is down and hard-stops workflows if local models are missing—preventing silent fallback to expensive cloud pools.
3. **0-Token Knowledge Graph Pre-Fetch (`codebase-memory-mcp`):**
   - Pre-fetches top symbol coordinates (`file:start-end`) before Discovery and 2-hop impacted call-graph nodes (`detect_changes`) before Audit in **0 LLM tokens**.
4. **Inlined Rule Digests & Dynamic `REPO_MAP_DIGEST`:**
   - Pre-computes Prisma models, `src/lib/*` domains, and Server Action modules in `<5ms` Python and inlines compressed rule digests so subagents never waste turns calling `read_file` on markdown docs.
5. **Pool-Safe `FALLBACK_CHAINS`:**
   - Steps down through cheaper 5-hour tiers (`pro -> flash -> flash_lite -> inherit`) before touching `inherit`, protecting weekly reserve model pools.
6. **Quiet CLI Verification (`node .agents/scripts/quiet-cli.mjs <tsc|lint|unit|pr-check>`):**
   - Emits 1-line receipts (`[quiet-cli] unit: PASS`) on green runs and caps failure output at 35 actionable lines.
7. **Parallel Tool Batching & Caveman Output Compression:**
   - Forces subagents to batch independent tool calls into 1 parallel turn and return terse `file:line` receipts / strict JSON instead of verbose prose.

---

## Repository Layout

```text
.agents/
├── AGENTS.md                       # Global management policies & Subagent Registry
├── project.config.json             # Single declarative config customized per repository
├── project.config.example.json     # Starter template
├── hooks.json                      # SessionStart & PreToolUse safety hooks
├── base/
│   ├── ORCHESTRATION.md            # Hybrid Quota Policy (Options A+B+C), Tracks S/M/L
│   ├── CORE.md                     # TypeScript, 100-line modularity, data contracts
│   ├── PRODUCTION.md               # Reliability, 7-Point AI Security Checklist
│   ├── UI_UX.md                    # Design system, ergonomics, a11y, microcopy
│   └── VARIABLES.md                # Canonical paths, commands, verdicts
├── hooks/
│   ├── session-start.mjs           # Git + Auto-Start Local Ollama + Graph banner
│   └── pre-tool-guard.mjs          # Secret guard, 100-line guard, main-branch protection
├── scripts/
│   ├── workflow_common.py          # Shared FALLBACK_CHAINS, Ollama auto-start, Graph pre-fetch
│   ├── parallel-discovery.py       # Stage 1: Product || Discovery workflow
│   ├── parallel-audit.py           # Stage 4: 0-token Python + Local Ollama + 1 Cloud Auditor
│   └── quiet-cli.mjs               # 1-line tsc / lint / vitest wrapper
└── plugins/
    └── zeroburn/
        ├── plugin.json             # Native plugin manifest
        └── agents/                 # 8 specialized subagent definitions
```

---

## Quick Start

1. Copy `.agents/` into your repository root.
2. Customize `.agents/project.config.json` for your repository paths and local Ollama models.
3. Ensure local Ollama models are pulled:
   ```bash
   ollama pull qwen2.5-coder:14b
   ollama pull gemma4:latest
   ```
4. Use `node .agents/scripts/quiet-cli.mjs pr-check` for zero-noise agent verification.

---

## Attribution

Open-sourced by the engineering team building **[directly.social](https://directly.social)** (`@directlysocial`).
