# Project Udyam Digital

Team RNG's entry for Airtel SYNC (YTL Hackathon 2026, Enterprise Track A).

**Status:** [docs/blueprint.md](docs/blueprint.md) holds the phases, challenges, open decisions and cut order, and [docs/decisions-for-you.md](docs/decisions-for-you.md) holds what's waiting on a decision. One person is building with Claude. The app runs end to end, with the four modules, the back office and the architecture diagram and privacy note done. The video and final deck remain. Update this file when a decision changes.

## Overview and objectives

Build a **digital-first acquisition and onboarding journey that lets a small business owner discover the right bundle, buy it and get it activated with minimal human effort, on a phone, in their preferred language.**

The operator in the case is fictional. Use **Accel Telecom / Accel Business** in the product. All data is synthetic, but treat it as real customer data.

### The problem in numbers (Apr to Jun 2026, `smb_leads.csv`)

| Metric | Baseline |
|---|---|
| Lead-to-activation | 7.36% (368 of 5,000) |
| Steepest funnel drop | Needs assessed to quote accepted, 44% |
| Acquisition cost per activation | ₹15,053 |
| Time to activate | 17.6 days |
| Status chases per customer | 3.01 |
| 6-month churn | 15.2% |

### Questions the submission must answer

1. Which MSME segments come first, and what bundle, price and contract fits each?
2. How does needs discovery work without a salesperson?
3. How can KYC be near-instant while complying with the DPDP Act 2023?
4. How do the field force and channel partners add to the digital journey, not compete with it?
5. Which 3 to 5 metrics define success, and what are the targets?

## Mandatory deliverables

| # | Deliverable | Limit | Location |
|---|---|---|---|
| 1 | Working prototype: demo video and code repository | Video 3 minutes max | `src/`, `docs/demo/` |
| 2 | Solution architecture diagram with components and data flows | | `docs/architecture/` |
| 3 | Business case: target customer, value, pricing or savings, rollout, risks | 10 slides max, on `6ad9d4887d445_airtel_sync/Submission Template_Sync.pptx` | `docs/business-case/` |
| 4 | Data privacy and security note | 1 page | `docs/privacy-note/` |

The prototype must include:

| Module | Requirement |
|---|---|
| **Advisor** | GenAI assistant that asks about the business and recommends a catalogue bundle, explaining why in plain language |
| **Quote and checkout** | One transparent monthly price with add-ons the owner can toggle |
| **Smart KYC** | Document upload with extraction and validation, mocked GSTIN and Udyam lookups, and a clear consent screen |
| **Tracker** | An order status view the owner can check instead of calling support |

Stretch goals, only after the core works: voice or WhatsApp front end, back-office view of leads the advisor couldn't close, simple propensity score.

**How we're judged:** judges hold a private pack of 15 advisor scenarios run live, a KYC answer key and the signals planted in the leads data. Edge cases are tested directly. Never seek or use that pack.

The case's 3-minute limit, 10-slide limit and 1-page limit are hard limits. The pack doesn't state a deadline. **Deadline: the team says there is enough time, with no exact date recorded yet.**

## Source data

Everything is in `YTL_TrackA_Udyam_Digital_Data/`, and **these files are read-only**. See its `README.md` for column definitions.

| File | Rows | Use |
|---|---|---|
| `product_catalogue.csv` | 25 | Advisor and quote |
| `smb_leads.csv` | 5,000 | Analytics and propensity |
| `mock_gstin_registry.csv` | 3,534 | GSTIN lookup |
| `mock_udyam_registry.csv` | 2,723 | Udyam lookup |
| `kyc_documents/` | 47 images | KYC specimens K01 to K12 |

### Traps to remember

- **"Today" is 2026-07-15** for all date checks, via `APP_TODAY`.
- **Don't learn from past bundles unfiltered:** 56 of 368 break a catalogue rule.
- **Acquisition cost** is total spend over all leads divided by activations (₹15,053), not an average over activated leads (₹5,385).
- **Load CSVs with `keep_default_na=False`**, because `None` is a real value in two columns.
- **Accept `X`** as the 4th PAN character in GSTINs and district `00` in Udyam numbers.
- **Cancelled and Suspended GSTINs** count as no GSTIN.
- **Udyam certificate dates and activity** differ from the registry even on good applicants, so these are soft checks.
- **Prices are ranges** in the catalogue, so one pricing constant converts them to a single price.
- **Don't filter the specimen watermark before OCR.** It cut field accuracy from 97% to 77%.
- **A checksum failure on an OCR value isn't a rejection yet.** OCR misreads K10's valid GSTIN, so the owner confirms the value first.

## Technical architecture

### Principles

1. **Code decides, the LLM explains.** Eligibility, pricing and KYC verdicts are deterministic code. The LLM never overrides them.
2. **The journey survives failure.** If the LLM, OCR or a registry is down, the owner can still finish or resume.
3. **Privacy by design.** Consent first, collect the minimum, mask everywhere, keep documents local by default.
4. **External services sit behind interfaces**, so mocks can be replaced later.
5. **One deployable app** for the hackathon. Don't add services without a clear need.

### Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js (App Router), React, TypeScript strict | One codebase for UI and API |
| Styling | Tailwind CSS with `airtel-design-system` tokens | Consistent, fast to build |
| Validation | Zod | Shared request, response and LLM schemas |
| Database | SQLite through libSQL and Drizzle | No native build on Windows; can move to a hosted database |
| LLM | Gemini on a free key behind `LlmProvider`: `gemini-3.5-flash-lite`, then `gemini-2.5-flash` ([results](docs/spikes/llm-choice.md)). One step reads facts, and another words a brief without seeing the owner's text | No paid key is available. Models in config, and the journey works with the LLM off |
| OCR | `tesseract.js` behind `OcrProvider`, with `sharp` for quality checks | Runs locally, so documents don't leave the app. 96.8% of fields on the specimens, phone photos untested ([results](docs/spikes/ocr-accuracy.md)) |
| i18n | Message catalogues per locale | English and Hindi first, then regional |
| Tests | Vitest, Playwright, axe | Unit to browser |
| Analytics | Python and pandas in `analytics/` | Outputs feed the deck and dashboard |

### Project structure

```
src/
  app/                 Next.js routes; API handlers in app/api/v1
  components/ui/       Design system components
  components/features/ advisor, quote, kyc, tracker, backoffice
  domain/              Pure business logic with no framework or database imports
    advisor/ analytics/ catalogue/ eligibility/ pricing/ bundle/ kyc/ orders/
  server/
    db/                Schema, migrations, repositories
    llm/               Provider, prompts, tools, output guard
    adapters/          registry, ocr, storage, notifications
    auth/ consent/     Guards used by API handlers
  lib/                 Masking, money, clock, logger
  i18n/                Message catalogues
scripts/               Seed and import
analytics/             Funnel, segments, propensity
tests/                 unit, regression, integration, e2e, scenarios, fixtures, helpers
docs/                  architecture, business-case, privacy-note, demo
```

### Main flow

```
Owner's phone
  -> Advisor: LLM <-> tools -> domain/eligibility + domain/pricing -> catalogue
  -> Quote: domain/pricing on every toggle
  -> Consent gate
  -> KYC: upload -> quality gate -> OCR -> validation -> registry adapter -> cross-checks -> verdict
  -> Order -> Tracker (dates from typical_install_days)
Back office <- leads not closed + propensity score
```

Dependency direction: `app` to `server` to `domain`. `domain` imports nothing from the others.

## Coding conventions

- TypeScript `strict`, no `any` without a comment explaining why.
- Files are `kebab-case.ts`, components `PascalCase`, functions `camelCase`, constants `SCREAMING_SNAKE_CASE`.
- Prefer named exports, small pure functions and early returns.
- Keep files focused. If one grows past about 300 lines, look for a split.
- Comments explain why, not what. Record assumptions next to the constant they affect.
- Use `Clock` from `src/lib` for time; never `new Date()` in domain code.
- Money is integer rupees in `_inr` names. Format it only at the display edge.
- All UI text comes from message catalogues.
- Don't add a dependency when a few lines will do, and note the reason when you add one.
- Keep changes scoped to the task. Don't refactor nearby code on the way past.

## API conventions

- REST under `/api/v1`, with plural nouns: `/api/v1/quotes`, `/api/v1/orders/{id}`.
- JSON bodies use `camelCase`. Dates are ISO 8601. Money fields end in `Inr`.
- Validate every request with Zod, and reject unknown fields.
- Success returns the resource directly. Errors always look like:

```json
{ "error": { "code": "CONSENT_REQUIRED", "message": "Safe message", "details": {}, "requestId": "..." } }
```

| Status | Use |
|---|---|
| 200, 201 | Success, created |
| 400 | Invalid input |
| 401, 403 | Not signed in, not permitted or no consent |
| 404 | Not found, **including another owner's object** |
| 409 | Conflict with current state |
| 422 | Valid request that a business rule rejects |
| 429 | Rate limited |
| 503 | A dependency is down; the client can retry |

- Use idempotency keys on order creation and uploads.
- Use cursor pagination on lists.
- Public IDs are random, never sequential.
- Identifiers don't go in URLs from the client. The mock registry's `GET` is server-to-server.

## Database conventions

- Tables are plural `snake_case`; columns are `snake_case`; foreign keys are `<entity>_id`.
- Every table has `id`, `created_at` and `updated_at`. Timestamps are UTC ISO 8601.
- Change the schema only through Drizzle migrations, committed with the code.
- Enums are text columns with check constraints.
- Keep `kyc_*` tables separate from analytics, with no shared join for marketing use.
- `consents` and `audit_log` are append-only.
- Store document files outside the database, encrypted.
- Seeds are idempotent and read from the data pack.

Core tables: `products`, `leads`, `gst_registry`, `udyam_registry`, `conversations`, `quotes`, `quote_lines`, `orders`, `order_events`, `consents`, `kyc_applications`, `kyc_documents`, `kyc_checks`, `audit_log`.

## Security and privacy requirements

Load `privacy-security` for detail. Non-negotiable:

- Show the notice and record consent **before** any KYC collection, enforced on the server.
- Separate consent per purpose, with withdrawal as easy as granting. Marketing is never bundled.
- Collect only what each step needs, and justify each new field.
- Mask identifiers in UI, logs and analytics.
- Check ownership on every object access.
- Keep documents encrypted and non-public, with retention enforced by a job.
- Don't send documents, raw OCR text, names or full identifiers to the LLM.
- Treat chat and OCR text as untrusted. The LLM has no tool that can bypass a rule.
- Keep secrets in `.env.local`, and commit only `.env.example`.
- Every statement in the privacy note must be true of the code.

## Testing requirements

Use TDD for `src/domain` and the KYC checks.

| Level | Tool | Must cover |
|---|---|---|
| Unit | Vitest | Each eligibility rule at, below and above its boundary; pricing; GSTIN and Udyam validation; KYC checks; masking |
| Data regression | Vitest | 368 of 368 setup fees and contracts match; exactly 56 bundles flagged; funnel and ₹15,053 reproduce |
| Integration | Vitest | API contracts; consent and ownership failures; registry 200, 400, 404 and 503 |
| Scenario | Vitest with a mocked LLM, plus a separate live run | At least 15 advisor scenarios; K01 to K12 fixtures |
| E2E | Playwright | Full journey at 360 px, English and Hindi; `axe` clean |

**Before saying anything is done:** run the relevant tests and quote the result. Say clearly what wasn't run. Don't weaken a test to make it pass.

**Before the demo:** run the full suite, a live LLM scenario pass, and the flow with the LLM and registry deliberately switched off.

## Git conventions

- Branch from `main` as `feat/advisor-chat`, `fix/gstin-checksum`, `docs/privacy-note`.
- Use Conventional Commits: `feat(kyc): add bill age check`. Types are `feat`, `fix`, `test`, `docs`, `refactor`, `chore`.
- Keep commits small and passing. Merge through a PR when teammates are involved.
- Never commit `.env*` (except `.env.example`), uploaded documents, `__MACOSX`, build output or `node_modules`.
- The data pack and case folder stay out of git for now (blueprint decision 3), so seeds read them from a configured folder.
- Commit `.claude/` and `skills-lock.json`, so teammates get the same setup.
- Never force-push `main`. Commit or push only when asked.

## Using subagents and skills

### Subagents (`.claude/agents/`)

| Agent | Use for | Doesn't touch |
|---|---|---|
| `frontend-engineer` | Screens, components, responsive UI | Business rules, schema, prompts |
| `backend-engineer` | APIs, schema, `src/domain`, adapters | UI, prompts |
| `ai-engineer` | Advisor loop, prompts, guards, evaluations | The rules themselves |
| `kyc-specialist` | OCR, validation, cross-checks, consent flow | Design system, unrelated APIs |
| `qa-engineer` | Tests and defect reports | Product code |
| `security-reviewer` | Read-only audits, privacy note checks | Everything; reports only |

- Small changes don't need a subagent.
- Give each agent the files in scope and what done looks like.
- Run agents in parallel only when they touch different files.
- Build in contract order: domain and API, then advisor and UI.
- After a feature, run `qa-engineer`. After anything touching personal data, and before submission, run `security-reviewer`.
- An agent's report isn't proof. Check the diff and test output.

### Project skills (`.claude/skills/`)

| Skill | When |
|---|---|
| `msme-advisor` | Catalogue, eligibility, pricing, advisor |
| `smart-kyc` | Documents, OCR, registries, verdicts |
| `airtel-design-system` | Any UI |
| `msme-analytics` | Numbers, KPIs, dashboards, propensity |
| `privacy-security` | Personal data, auth, uploads, privacy note |

### Installed skills and plugins

| Source | Use |
|---|---|
| `superpowers` plugin (skills are named `superpowers:<skill>`) | `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review` |
| `vercel-react-best-practices` | Any React or Next.js code |
| `frontend-design:frontend-design`, `ui-ux-pro-max:ui-ux-pro-max` | Visual ideas and quality |
| `webapp-testing` | Browser checks of the running app; needs Python Playwright, which isn't installed yet |
| `doc-coauthoring` | Business case and privacy note drafting |
| Document skills already on this account (`docx`, `pdf`, `pptx`, `xlsx`) | The submission deck and other files |
| `dataviz`, `security-review`, `code-review` | Charts, security and code review |

### Which instructions win

1. This file
2. Project skills in `.claude/skills/`
3. Installed plugins and general skills

For example, `airtel-design-system` overrides the look suggested by `ui-ux-pro-max`, and its bundled `brand`, `design` and `design-system` skills. Superpowers suggests a heavy workflow, so scale it to the task: a small fix doesn't need a brainstorm or a worktree.

## Definition of done

- [ ] Meets the requirement in the case, including its awkward paths
- [ ] Tests written and passing, with the result quoted
- [ ] Works at 360 px in English and Hindi, where it has a UI
- [ ] No rule, price or verdict comes from the LLM
- [ ] No unmasked identifier in the UI or logs
- [ ] Assumptions noted, and docs updated if behaviour changed
