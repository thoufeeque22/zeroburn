# Core Technical Standards

## TypeScript & Next.js 16 / React 19
- **Zero `any` Policy:** Never use `any`. Parse external JSON/API responses as `unknown` and validate with Zod schemas in `src/lib/schemas/`.
- **Error Narrowing:** Always write `catch (error: unknown)` and narrow (`error instanceof Error ? error.message : String(error)`).
- **Discriminated Union Server Actions:** Declare explicit return types with literal `success: true` vs `success: false` so consumers narrow cleanly under `tsc`.
- **Server Actions Directive:** `'use server';` MUST be on line 1 of every Server Action file (never place imports above it, or App Router throws a 500 error).
- **Clean Typing:** Avoid arbitrary `as Type` casts; never chain `as unknown as Type` except for incompatible third-party SDK types (prefer precise structural intersections). In tests, type callback `this` explicitly (`function(this: unknown)`).
- **React 19 Forms & Client Boundaries:** Use `<form action={...}>` with `FormData` instead of `onSubmit` + `FormEvent`. Add `'use client'` only when hooks or browser APIs are needed.
- **SSR & Hydration Safety:** Use `globalThis` instead of `window` for globals. Never read `localStorage`/`sessionStorage` during render, in `useState(...)` initializers, or in `useMemo`. Hydrate inside `useEffect` from a stable default. Clean up side effects in `useEffect` return functions.
- **Middleware (`proxy.ts`):** Next.js 16 uses `src/proxy.ts` (never `middleware.ts`). Keep it Edge-compatible (use `supabase/middleware.ts`; never import Prisma).
- **Large Media OOM Safety:** When mocking large media client-side (e.g., demo videos), never call `await res.blob()`. Use a 0-byte `new File([], 'name', { type: 'video/mp4' })` + URL mapping.
- **TSX Formatting:** Never use markdown `**bold**` or `*italic*` in TSX text nodes; use `<strong>` / `<em>`.
- **Package Manager:** Always use `pnpm install <pkg>` (never `npm`).

## Modularity & Code Cleanliness
- **100-Line Rule:** ESLint enforces `["error", { "max": 100, "skipBlankLines": true, "skipComments": true }]` (`src/__tests__/**` exempt).
  - New files MUST be `≤ 100` lines.
  - **UI Components:** NEVER use `/* eslint-disable max-lines */`. Extract sub-components/hooks.
  - **Non-UI Files:** May use `/* eslint-disable max-lines */` ONLY with a one-line justification explaining why splitting adds harmful indirection.
  - **Legacy Files (`> 100` lines):** Any touch requires extracting logic into compliant modules; only remove the disable flag once `< 100` lines.
  - **No Linter Evasion:** Never collapse multi-line `if`, Prisma calls, or JSX onto one line to game line counts.
- **Control Flow & Helpers:** No nested ternaries (use `Record<K, V>` maps or helpers). Prefer optional chaining (`?.`), `some`/`every` over complex `reduce`, and `Date.now()` over `new Date().getTime()`. Split functions exceeding ~15 lines of dense logic.
- **Cleanup:** Remove unused imports/props immediately (`@typescript-eslint/no-unused-vars`).
- **Naming:** Components `PascalCase.tsx`, hooks `useCamelCase.ts`, utilities `camelCase.ts`. Extract logic from UI into `src/hooks/`.

## Centralized Constants & Data Contracts
- **No Hardcoded App Strings:** Use `BRAND` (`src/lib/core/brand.ts`), `CONTACT_EMAILS` (`src/lib/core/emails.ts`), `APP_CONFIG` (`src/lib/core/config.ts`), `PLATFORMS` (`src/lib/core/constants.ts`).
- **Deprecated Fields:** `User.bio` is deprecated — always use `personalNotes`.
- **Prisma `createMany` Contract:** When calling `prisma.<model>.createMany` on models using `@default(cuid())` or `@default(uuid())`, explicitly generate unique IDs (e.g., `id: randomUUID()`) in mapped rows or use transactional `upsert`. Unit tests for bulk inserts MUST assert non-null, unique `id`s are passed.
- **Prisma Indexes:** User-scoped models MUST have `@@index([userId])` plus compound indexes (e.g., `[userId, scheduledAt]`, `[userId, isPublished]`) and Inngest scheduler filter indexes (`status`, `scheduledAt`).
- **Schema Sync:** On `schema.prisma` edits, run `npx prisma generate` + `npx prisma db push` locally, and prepare migration/SQL steps for staging & prod.
- **Automated Invariant Enforcement:** `.agents/hooks.json` (`PreToolUse`) and `src/__tests__/unit/orchestration-invariants.test.ts` (`pnpm test`) enforce Prisma `userId` indexes, sensitive API `rateLimitRegistry` coverage, 100-line/emoji/env guards, and orchestration hygiene automatically.

## Latency, Loading & Error Handling
- **Zero Waterfalls:** Fetch independent startup/page data concurrently via `Promise.allSettled` or parallel Server Components.
- **Latency Thresholds:** `< 300ms`: no spinner; `1s–5s`: layout-preserving skeletons; `5s–10s`: progressive status copy; `> 10s`: determinate progress bar/milestone checklist + "safe to navigate away" copy.
- **Zero-Leak 3-Part Errors:** Never leak raw DB/Prisma/third-party error codes to UI. Always show: (1) what happened in plain language, (2) why, (3) concrete next action. Log via Sentry.
- **Async Reset:** Reset loading/disabled button states inside `finally` blocks.
