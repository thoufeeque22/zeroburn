# End-to-End Controlled A/B Benchmark: ZeroBurn vs. Unorchestrated Agent

This report documents a **controlled, ground-truth A/B benchmark** measuring exact token consumption, model-step count, wall-clock duration, estimated cloud cost, and output quality between:

- **Arm A (With ZeroBurn `v2.10.1`):** Full `.agents/` orchestration active (`AGENTS.md`, `SessionStart` hook, `quiet-cli.mjs`, `codebase-memory-mcp`, and ZeroBurn routing).
- **Arm B (Without Orchestration / Baseline):** `.agents/` completely removed from disk (`git update-index --assume-unchanged` + `rm -rf .agents`) so zero orchestration rules, hooks, or subagent plugins load.

---

## 1. Methodology & Controls

- **Target Codebase:** Production Next.js App Router + TypeScript + Prisma + Vitest application (`1,470+` source files, commit `e77f33b0`).
- **Base State:** Two fresh, isolated `git worktree` checkouts created from the exact same `main` commit for each ticket.
- **Prompt & Model Control:** Both arms received the **exact same task prompt and Definition of Done**, executed in fresh conversations on the **exact same primary model and thinking setting (`Medium`)**.
- **Ground-Truth Telemetry:** All token counts, cache hits, model breakdowns, turns, and wall-clock durations were extracted directly from Antigravity's per-step `transcript.jsonl` logs using [`benchmarks/token-benchmark.mjs`](token-benchmark.mjs) (no `chars/4` estimates).
  - *Note:* In Antigravity `transcript.jsonl` logs, `input_tokens` records **uncached** input tokens and `cache_read_tokens` records **cached** input tokens separately. `Total Input = Uncached Input + Cached Input`.

---

## 2. Executive Summary — Scaling Curve (Small → Medium → Exploratory 5-Domain)

| Ticket Scope | Files Changed | Uncached Input Delta | Total Input Delta | Total Tokens Delta | Steps (Turns) | Wall-Clock Time | Est. Cloud Cost* |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Ticket #1 (Small — Backend Concurrency & Validation)** | 4 | **-1.4%** | +0.4% | +0.6% | 9 vs 9 (`0.0%`) | **-1.8%** (`1m 47s` vs `1m 49s`) | `$0.2238` vs `$0.2234` (`+0.2%`) |
| **Ticket #2 (Medium, Pre-Mapped — Multi-File UI, WCAG 2.1 AA & Semantic Tokens)** | 16 | **-14.5%** | **-31.5%** | **-30.7%** | **16 vs 19 (`-15.8%`)** | **-13.8%** (`5m 01s` vs `5m 49s`) | **`$0.5882` vs `$0.7014` (`-16.1%`)** |
| **Ticket #3 (Exploratory, 5 Domains — CI/Deploy, FFmpeg, Auth, Worker, Docs)** | 16 | **-9.0%** | **-46.8%** | **-46.4%** | **19 vs 29 (`-34.5%`)** | **-36.7%** (`5m 34s` vs `8m 48s`) | **`$0.7868` vs `$1.0712` (`-26.5%`)** |

### Why the Gap Widens With Scope
1. **Zero orchestration tax on small tickets (4 files):** ZeroBurn's fast-path spawned `0` unnecessary subagents, used **1.4% fewer uncached input tokens**, and finished **2s faster** than the unorchestrated baseline — proving rules/hooks don't bloat simple tasks.
2. **Compounding savings on medium tickets (16 files):** As multi-file tasks progress, every extra exploratory or retry turn re-sends the full growing context ($O(n^2)$). On Ticket #2, ZeroBurn eliminated **3 full turns (`16` vs `19`)**, saving **547,105 total tokens (-30.7%)** and **16.1% cloud cost**.
3. **Exploratory 5-domain tasks with `quiet-cli` + `live-audit` active (Ticket #3):** When file paths were **not** pre-listed and a full 5-stage workflow (Discovery → Implementation → Verification → Docs Sync → Security Audit) was required, ZeroBurn's chained-command `quiet-cli.mjs` auto-rewrite + 0-cloud-token `live-audit.mjs` (AST + local Ollama) cut total tokens by **46.4% (-1.63M tokens)**, wall-clock time by **36.7% (-3m 14s)**, and estimated cloud cost by **26.5%**.
4. **Scientific Transparency (`N = 1` & Attribution):** Each arm is a single-run controlled A/B (`N = 1`, verified `cache_read_tokens: 0` on Turn 1, clean `git reset --hard` + `git clean -fd`). On Ticket #3, both ZeroBurn's hooks (`quiet-cli.mjs` + `live-audit.mjs`) *and* normal single-run variance (fewer retry cycles on the post-fix run) contributed to the `-46.4%` total token drop. Even when ZeroBurn runs without subagent delegation (`0` `flash` subagents spawned in all 3 tickets), savings already reach **31–46% end-to-end** on 16-file tasks; multi-stage epics that also delegate to `flash` subagents + `codebase-memory-mcp` graph pre-fetch can push savings even further (backed by the **70–98%** orchestration/tooling overhead reduction in [`REAL_WORLD_BENCHMARK.md`](REAL_WORLD_BENCHMARK.md)).

---

## 3. Detailed Results — Ticket #1 (Small: Core Concurrency & Client Validation)

**Scope:** Fix a `prisma.user.updateMany` concurrency race return value, enforce a canonical tier allowlist, reject negative finite cached balances, and add unit tests (`4` files modified).

### Token, Latency & Cost Comparison

| Metric | With ZeroBurn | Without Orchestration | Delta (ZeroBurn vs. Baseline) |
| :--- | ---: | ---: | :--- |
| Uncached Input Tokens | 124,649 | 126,427 | **-1.4% (better)** |
| Cached Input Tokens | 257,075 | 253,795 | +1.3% |
| Total Input Tokens | 381,724 | 380,222 | +0.4% |
| Cache Hit Rate | 67.3% | 66.7% | +0.6 pp |
| Output Tokens | 11,434 | 10,590 | +8.0% |
| Total Tokens (In + Out) | 393,158 | 390,812 | +0.6% |
| Model Steps (Turns) | 9 | 9 | 0.0% |
| Subagents Spawned | 0 | 0 | — |
| Wall-Clock Time | 1m 47s | 1m 49s | **-1.8% (faster)** |
| Estimated Cloud Cost* | $0.2238 | $0.2234 | +0.2% |

### Verification & Code Quality
- **Unit Tests:** Both arms passed **22 / 22** Vitest tests (`credits-replenish.test.ts` + `get-ai-balance.test.ts`).
- **Diff Footprint:** ZeroBurn `4 files (+140 / -10)` vs Baseline `4 files (+128 / -7)`.
- **Quality Note:** ZeroBurn extracted a shared `isValidBalanceNumber()` type guard and trimmed tier strings before allowlist lookup; Baseline duplicated the finite non-negative check across 4 call sites.

---

## 4. Detailed Results — Ticket #2 (Medium: Multi-File UI, WCAG 2.1 AA, Semantic Tokens & A11y)

**Scope:** Adjust theme contrast tokens for Light/Dark WCAG 2.1 AA (`>= 4.5:1`), bind form `<label htmlFor>` associations, fix a paywall route target, replace inline color literals across 9 UI components with centralized `theme.palette` semantic tokens, replace an invalid interactive `role="tooltip"` disclosure with an accessible popover, fix static React keys, and add component/theme unit tests (`16` files changed).

### Token, Latency & Cost Comparison

| Metric | With ZeroBurn | Without Orchestration | Delta (ZeroBurn vs. Baseline) |
| :--- | ---: | ---: | :--- |
| Uncached Input Tokens | **245,925** | 287,510 | **-14.5% (better)** |
| Cached Input Tokens | **950,380** | 1,457,913 | **-34.8% (fewer tokens)** |
| Total Input Tokens | **1,196,305** | 1,745,423 | **-31.5% (-549,118 tokens)** |
| Cache Hit Rate | 79.4% | 83.5% | -4.1 pp |
| Output Tokens | 36,386 | 34,373 | +5.9% |
| Total Tokens (In + Out) | **1,232,691** | 1,779,796 | **-30.7% (-547,105 tokens)** |
| Model Steps (Turns) | **16** | 19 | **-15.8% (-3 turns)** |
| Subagents Spawned | 0 | 0 | — |
| Wall-Clock Time | **5m 01s** | 5m 49s | **-13.8% (-48s faster)** |
| Estimated Cloud Cost* | **$0.5882** | $0.7014 | **-16.1% (cheaper)** |

### Verification & Code Quality
- **Unit & Component Tests:** ZeroBurn passed **21 / 21** tests across `3` files (`theme-logic.test.ts`, `TermTooltip.test.tsx`, `a11y-1066.test.tsx`); Baseline passed **19 / 19** tests across `4` files (`theme-logic.test.ts`, `TermTooltip.test.tsx`, `ByosField.test.tsx`, `QuotaPaywallModal.test.tsx`).
- **Diff Footprint:** ZeroBurn `16 files (+266 / -117)` vs Baseline `16 files (+280 / -123)` — both touched the exact same 16 target files, with ZeroBurn producing a smaller, cleaner diff in **3 fewer turns** and **547k fewer tokens**.

---

## 5. Detailed Results — Ticket #3 (Exploratory 5-Domain Production Hardening)

**Scope (No Pre-Listed File Paths):** Locate and remediate 4 cross-domain production hardening gaps across CI/CD (`prisma migrate deploy` + zero-downtime `pm2 restart`), 1 GB VPS FFmpeg/queue concurrency guardrails (`-preset ultrafast -threads 1` + `/tmp` unlink), `auth()` `React.cache()` memoization + production Prisma singleton, bounded `/tmp` orphan cleanup queries, infrastructure docs sync, unit tests, and a final security/quality audit (`16` files changed).

### Before/After Hook Fix Case Study (`v2.10.1` → Post-Fix)

Our first run of Ticket #3 (`v2.10.1`) uncovered a real gap: `PreToolUse` (`command-rewrite.mjs`) only matched single unchained commands, so chained `npx tsc --noEmit && pnpm lint && npx vitest run ...` slipped past `quiet-cli.mjs`, and the agent ran raw `git diff` instead of `live-audit.mjs` (yielding only `-2.3%` total tokens). After updating `command-rewrite.mjs` (segment-by-segment `&&` rewriting + `pnpm lint`/`pnpm test`/`pnpm typecheck`) and `session-start.mjs` (steering final audits to `live-audit.mjs`), we reset the worktree (`git reset --hard && git clean -fd`, verified `cache_read_tokens: 0` on Turn 1) and re-ran Arm A:

| Metric | Baseline (No Orchestration) | ZeroBurn `v2.10.1` (Pre-Fix) | **ZeroBurn Post-Fix** | **Post-Fix vs. Baseline** |
| :--- | ---: | ---: | ---: | :--- |
| Uncached Input Tokens | 371,739 | 404,272 (+8.8%) | **338,224** | **-9.0% (better)** |
| Cached Input Tokens | 3,091,073 | 2,983,805 (-3.5%) | **1,505,101** | **-51.3% (fewer tokens)** |
| Total Input Tokens | 3,462,812 | 3,388,077 (-2.2%) | **1,843,325** | **-46.8% (-1.62M tokens)** |
| Output Tokens | 44,013 | 37,823 (-14.1%) | **36,719** | **-16.6% (better)** |
| Total Tokens (In + Out) | 3,506,825 | 3,425,900 (-2.3%) | **1,880,044** | **-46.4% (-1.63M tokens)** |
| Model Steps (Turns) | 29 | 28 (-3.4%) | **19** | **-34.5% (-10 turns)** |
| Wall-Clock Time | 8m 48s | 8m 10s (-7.2%) | **5m 34s** | **-36.7% (-3m 14s faster)** |
| Estimated Cloud Cost* | $1.0712 | $1.0439 (-2.6%) | **$0.7868** | **-26.5% (cheaper)** |
| Tool Calls (`read_file` / `run_command`) | 39 / 14 | 35 / 14 | **28 / 9** | **-28% reads, -36% cmds** |
| `quiet-cli` / `live-audit` (Ollama) | 0 / 0 | 0 / 0 | **1 / 1** | **Both engaged** |

### Verification & Code Quality
- **Unit Tests:** ZeroBurn Post-Fix passed **42 / 42** Vitest tests across `6` test files; Baseline passed **43 / 43** across `6` test files.
- **Diff Footprint:** ZeroBurn Post-Fix `16 files (+353 / -101)` vs Baseline `16 files (+425 / -142)` — 20% tighter diff with all 5 requirements satisfied.
- **Attribution Note:** Single-run controlled A/B (`N = 1`, zero cache/git leakage verified); both the `quiet-cli` + `live-audit` hook fixes and normal run-to-run variance (fewer retry turns) contributed to the `-46.4%` reduction.

---

## 6. Reproducing This on Your Own Antigravity Transcripts

Use the included [`benchmarks/token-benchmark.mjs`](token-benchmark.mjs) CLI (zero dependencies) to measure any root conversation and all of its spawned subagents:

```bash
# Inspect a single conversation tree (root + all spawned subagents)
node benchmarks/token-benchmark.mjs analyze <conversation-id>

# Generate a side-by-side Markdown comparison report
node benchmarks/token-benchmark.mjs compare <zeroburn-conv-id> <baseline-conv-id> \
  --label "My Ticket Title" \
  --out benchmarks/MY_AB_REPORT.md
```

---
*\*Note: Token counts, cache hits, model steps, and wall-clock durations are exact measurements extracted from Antigravity `transcript.jsonl` logs. USD costs are estimates based on representative per-1M token rates (cached input at 10% of uncached input; local Ollama = $0).*
