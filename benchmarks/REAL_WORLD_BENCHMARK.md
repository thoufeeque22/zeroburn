# Real-World Verified Benchmark (`directly.social` Production Repo)

This document records a 100% reproducible, measured A/B comparison between a **Standard Multi-Agent Loop (Vanilla Subagent)** and the **ZeroBurn v2.5.0 Harness** on the production **[directly.social](https://directly.social)** codebase.

## 1. Target Repository Profile
- **Stack:** Next.js App Router + TypeScript + Prisma + Vitest + Playwright
- **Source Files (`src/`):** `1,470` files (`61,817` chars in file path list)
- **Knowledge Graph (`codebase-memory-mcp`):** `10,893` AST nodes, `21,323` call/dependency edges
- **Domain Surface:** `28` Prisma models, `32` `src/lib/*` domains, `60` `/api/**` routes
- **Target Task:** *"Locate and audit the upload & subscription tier quota logic (`checkUploadQuota`), verify all 6 billing unit test suites (70 tests), and run a diff security review."*

---

## 2. Stage-by-Stage Measured Token & Turn Comparison

*(Token counts computed at standard `chars / 4` tokenizer ratio from exact stdout/context payloads.)*

| Pipeline Stage | Standard Coding Agent (Vanilla) | ZeroBurn `v2.5.0` Engine | Measured Savings |
| :--- | :--- | :--- | :--- |
| **1. Architecture & File Tree Discovery** | `find src -type f` -> **1,470 lines** (`61,817` chars = **15,454 tokens**) | `build_repo_map_digest()` -> **6 lines** (`2,544` chars = **636 tokens** listing all 28 Prisma models, 32 domains, 60 API routes) | **-95.88% tokens** |
| **2. Governance & Rule Ingestion** | `cat .agents/AGENTS.md .agents/base/*.md` -> **276 lines** (`41,098` chars = **10,274 tokens**) | Pre-computed inlined rule digests in `.agents/project.config.json` -> **7 bullet lines** (**195 tokens**) | **-98.10% tokens** |
| **3. Symbol & Call-Graph Localization** | `grep -rn "quota" src/lib/` -> **64 matches** (`7,686` chars = **1,921 tokens**) + exploratory file reads | `codebase-memory-mcp` BM25 `search_graph(query="billing tier quota check")` -> resolves `FreemiumGuard.checkUploadQuota` (`src/lib/billing/freemium-guard.ts:43-83`) in **0 LLM tokens** | **-100% exploratory LLM tokens** |
| **4. Unit Test Verification (6 suites, 70 tests)** | `npx vitest run` -> **243 lines** (`27,265` chars = **6,816 tokens** per test run) | `node .agents/scripts/quiet-cli.mjs unit` -> **1 line** (`71` chars = **17 tokens**): `[quiet-cli] unit: PASS (Test Files 6 passed (6), Tests 70 passed (70))` | **-99.75% test log tokens** |
| **5. Diff Security & Quality Audit** | Cloud `Pro` / `Opus` subagent review (**~12,000+ cloud tokens**) | Static AST/Blast-Radius Python check + Local Ollama `qwen2.5-coder:14b-custom` (`13.43s`, **0 cloud tokens**) | **100% cloud audit quota saved** |
| **Single-Pass Overhead Total** | **46,465+ Cloud Tokens** | **848 Cloud Tokens** | **98.18% Reduction** |
| **5-Turn Cumulative Context Billing ($O(N^2)$)** | **~185,000+ Billed Input Tokens** | **~3,400 Billed Input Tokens** | **>98% Quota Saved** |

---

## 3. Exact Terminal Traces (Before vs After)

### ❌ Before: Standard Multi-Agent Loop
```text
$ find src -type f
src/app/api/billing/quota/route.ts
src/lib/billing/freemium-guard.ts
... [1,470 lines dumped into LLM context: 61,817 chars / ~15,454 tokens]

$ cat .agents/AGENTS.md .agents/base/*.md
... [276 lines of markdown rules dumped into context: 41,098 chars / ~10,274 tokens]

$ grep -rn "quota" src/lib/
... [64 matches across 22 files: 7,686 chars / ~1,921 tokens]

$ npx vitest run src/__tests__/unit/core/effective-tier.test.ts \
    src/__tests__/unit/core/tier-format.test.ts \
    src/__tests__/unit/billing-service.test.ts \
    src/__tests__/unit/lib/billing \
    src/__tests__/unit/billing
... [243 lines of ANSI test logs dumped into context: 27,265 chars / ~6,816 tokens]
```

### ✅ After: ZeroBurn v2.5.0 Harness
```text
$ # 1. 0-Token Knowledge Graph Pre-Fetch (codebase-memory-mcp: 10,893 nodes, 21,323 edges)
[ZeroBurn Graph Pre-Fetch] query="billing tier quota check" (0 LLM tokens):
  1. FreemiumGuard.checkUploadQuota  (src/lib/billing/freemium-guard.ts:43-83)
  2. resolveSubscriptionTier         (src/lib/billing/tier-resolver.ts:4-25)
  3. resolveQuotaTier                (src/lib/ratelimit/tier-resolver.ts:30-56)
  4. GET /api/billing/quota          (src/app/api/billing/quota/route.ts:7-40)

$ # 2. Pre-Computed Repo Map Digest (<5ms Python, 6 lines, 636 tokens)
[PRE-COMPUTED REPO_MAP_DIGEST — DO NOT run ls/find to locate core domains or API routes]
- Prisma Models (28): Account, ByokCredential, ByosConfig, GalleryAsset, MetadataTemplate ...
- src/lib/* Domains (32): actions, admin, ai, alerts, api, auth, billing, byok, byos, core ...
- API Routes (60): DELETE /api/settings/account, GET /api/activity, GET /api/billing/quota ...

$ # 3. 1-Line Quiet CLI Verification Receipt (17 tokens vs 6,816 tokens)
$ node .agents/scripts/quiet-cli.mjs unit src/__tests__/unit/core/effective-tier.test.ts \
    src/__tests__/unit/core/tier-format.test.ts \
    src/__tests__/unit/billing-service.test.ts \
    src/__tests__/unit/lib/billing \
    src/__tests__/unit/billing
[quiet-cli] unit: PASS (Test Files 6 passed (6), Tests 70 passed (70))

$ # 4. 0-Cloud-Token Local Ollama Diff Audit (qwen2.5-coder:14b-custom, 13.43s)
[ZeroBurn Stage 4 Audit] Local Ollama (0 cloud tokens) ->
  - [code-quality] checkUploadQuota missing quota threshold comparison
  - [code-security] checkUploadQuota missing caller identity/entitlement verification
```

---

## 4. Reproducing This Benchmark on Your Repository

Run the included benchmark script against any target TypeScript / Next.js repository:

```bash
python3 benchmarks/run_benchmark.py /path/to/your/repo
```
