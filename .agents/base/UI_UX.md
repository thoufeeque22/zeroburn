# UI & Aesthetic Standards

## Aesthetic & Theme
- **Design System Consistency: Maintain a warm, cohesive design system with soft shadows and human copy. Avoid harsh neon palettes or nested glass cards.
- **Material UI Only:** Use MUI components (`sx` prop, never invalid HTML/CSS props) and `@mui/icons-material` icons exclusively.
- **Zero Emojis in UI:** Strictly forbid raw Unicode emojis in UI components, labels, and buttons (permitted only in backend logs, CLI output, and internal docs).
- **Theme-Aware Colors Only:** Never hardcode `white`, `#FFFFFF`, `black`, `#000000`, or concatenate theme token strings (e.g., `error.main + '0a'`). Use theme HSL vars (`hsl(var(--...))`) and `alpha(theme.palette..., 0.x)`. Soft dark surface tokens (`#0F1117` / `#12141A`). Ensure brand badges (e.g., dark brand icons) remain visible in Dark Mode.

## Ergonomics, Typography & Layout
- **8pt Grid:** Margins, paddings, and gaps MUST be multiples of `8px` (`8, 16, 24, 32`).
- **Typography & Contrast:** Multi-line body `line-height` `1.4–1.6`, left-aligned, ≥ `4.5:1` WCAG 2.1 AA contrast in both Light and Dark themes.
- **Single Primary CTA:** Max one primary CTA button per screen/card/modal; secondary actions use `outlined`, `text`, or ghost variants.
- **Progressive Disclosure:** If a form/surface exposes > 4 non-essential parameters, place advanced options inside `<Accordion>`.
- **Mobile Thumb Ergonomics (`< 600px`):** Prioritize persistent bottom navigation for daily workflows (Dashboard, Compose, Schedule) over top hamburger menus.
- **A11y Semantics:** Every `<input>` has a linked `<label>` (`htmlFor`/`id` or wrapper). Never put `onClick` on `<div>`/`<span>`; use `<button>` or `<label>` wrappers.

## Copywriting, Pricing & Onboarding
- **Outcome-First Microcopy:** Ban vague labels (`OK`, `Submit`, `Yes`, `Continue`, `Click Here`, `Cancel`, `No`). State exact outcome/entity (`Schedule Post`, `Delete Post`, `Keep Editing`, `Upgrade to Pro`).
- **Destructive Actions:** Place at bottom/danger zone in error/red styling without forward navigation chevrons.
- **Pricing Anchors:** Show crossed-out anchor directly beside/above discounted price (`crossed-out anchor beside discounted price`); never write `"Actual price:"` or `"Value:"`.
- **Onboarding & Settings Fallback:** Any skippable onboarding step/survey MUST have a fallback configuration in Settings, and specific action-oriented copy explaining what skipping entails.

## Customer UI Copy Policy & Term-Tooltip Architecture
- **Bucket 1 — Signature Brand Vocabulary (`<brand-terms>`):**
  - Define domain-specific customer-facing terms and plain-English explanations centrally in `.agents/project.config.json`.
  - **Interactive Helper Pattern:** Require first exposure and dense UI elements (pricing cards, feature matrices, settings headers, banners) to use an interactive helper pattern (e.g., `<TermTooltip term="<brand-term>" />` or inline plain phrasing + tooltip).
  - **Canonical Doc Links:** Pair tooltips and setup forms with canonical documentation links (`https://example.com/docs/<guide>`).
- **Bucket 2 — Customer-Facing Tier Names:**
  - Always render human-readable tier names (`Free`, `Developer`, `Pro`, `Team`, `Enterprise`).
  - **Hard Ban on Raw DB Enums in UI:** Never render raw Prisma/DB enum identifiers (`FREE_DEV`, `FREE`, `PRO`, `TEAM`, `ENTERPRISE`) in any user-facing UI component; always use a helper formatter (e.g., `formatTierName(tier)`).
- **Bucket 3 — Internal Engineering Jargon Ban in Customer UI:**
  - Strictly ban exposing raw engineering/architectural concepts in customer alerts, toasts, upgrade banners, error messages, and pricing tables: `OAuth`, `SSRF`, `RBAC`, `Zod`, `RSC`, HTTP status codes (`403`, `500`), raw Prisma/database errors, or internal config keys.
  - **Setup Form Exception:** Technical provider setup forms keep provider-exact field labels (`Client ID`, `Client Secret`, `Bucket Name`, `S3 Endpoint URL`) so users can copy-paste from provider dashboards, but MUST be accompanied by friendly plain-English helper text and links out to the relevant setup doc guides.

## Modular Form Engine (`> 3` sections or `> 200` lines)
1. Context Provider/Consumer for shared form state (no prop-drilling).
2. Pure `index.tsx` entry (Provider + high-level layout).
3. Atomic `≤ 200`-line sub-components (`FieldGroup.tsx`, `FormActions.tsx`), `use*` hooks, `.types.ts`, `.utils.ts`.

## Brand Identity
- Primary name: `<your-brand-name>` (all UI, titles, OG tags, meta descriptions). Never shorten to "Directly".
- Social handle: `@<your-brand-handle>`. Icon-only favicon monogram: `<monogram>`.