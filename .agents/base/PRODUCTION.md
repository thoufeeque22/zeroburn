# Production Readiness & Infrastructure

## Production Readiness Standards (Anti-"Vibe Coding")
- **Reliability & Graceful Degradation:** Implement robust error handling with Sentry logging. Never swallow errors. Wrap top-level Prisma/DB calls in critical path rendering functions (like `auth()`) in `try/catch` blocks and return graceful fallbacks (e.g., minimal session) to prevent SSR from crashing the entire page during database schema drift or deployment windows.
- **Performance:** Consider caching strategies (Next.js Data Cache, Redis) and database index optimization.
- **Security:** Implement rate limiting on all public API routes and actions. Ensure strict input validation (Zod), explicitly enforcing `.max()` constraints on string and array inputs (e.g., text prompts, visual frames) to prevent Resource Exhaustion (DoS) attacks.
- **Scalability:** Design for high throughput (queues for long-running tasks, efficient sharding/partitioning for large datasets).
- **Observability & Maintenance:**
  - **API Documentation:** Maintain up-to-date Swagger/OpenAPI docs at `/api/docs`. This is critical for mobile (Capacitor) integration and future public API consumers.
  - **Logging:** Log critical business events and system health metrics.

## 7-Point AI Security Checklist
1. **Prompt Isolation & Injection Defense:** Separate system instructions from untrusted user content with explicit boundaries.
2. **Server-Side Entitlement & Credit Pre-Check:** Verify `getUserTier(userId)` and credit/quota balance BEFORE invoking any LLM or external AI provider.
3. **Strict Bounded Input Validation:** Parse all payloads with Zod schemas enforcing explicit `.max()` bounds on prompt strings, message arrays, and media/visual frames.
4. **Dedicated AI Rate Limiting:** Register every AI route in `src/lib/core/rate-limit-registry.ts` using `aiRateLimit`.
5. **Zero-Leak Output & Error Handling:** Sanitize/validate model outputs and wrap provider errors in 3-part zero-leak UI messages (never expose raw SDK/API errors).
6. **User-Supplied API Key Hygiene:** Encrypt stored user-supplied API keys at rest; never log, echo, or serialize plaintext keys back to client components.
7. **Timeout, Circuit Breaker & Sentry Logging:** Apply explicit request timeouts / spend caps and report unexpected AI provider failures to Sentry.

## Deployment & Server Infrastructure
- **Strict Prohibition on VPS In-Place Compilation:** Low-memory production runtime instances (e.g., 1GB RAM micro VMs) must strictly be treated as execution runtimes. It must strictly be treated as an execution runtime, NEVER a compilation environment. NEVER run `next build` on the VPS. Always build on a multi-core machine (GitHub runner or local Mac) and transfer pre-compiled artifacts via `rsync` using `pnpm run deploy:vps`.
