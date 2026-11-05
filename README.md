# Accel Business: Project Udyam Digital

Team RNG's entry for Airtel SYNC (YTL Hackathon 2026, Enterprise Track A). A small business owner discovers the right bundle, buys it and gets it activated on a phone, in English or Hindi, with minimal human effort.

Accel Business is the fictional operator in the case. All data is synthetic.

## What's in it

| Module | What it does |
|---|---|
| **Advisor** | Chat in any language, with tappable answers and a short form. Code chooses the bundle and the LLM only reads and words |
| **Quote and checkout** | One final monthly price including GST, add-ons to toggle, and a labelled mock payment |
| **Smart KYC** | Consent first, document upload, local OCR, mock GSTIN and Udyam lookups, cross-checks and a specific verdict |
| **Tracker** | What happens next and when, every stage with a date, and delays with reasons |
| **My data** | What's held, per-purpose consent, withdrawal and a grievance contact |
| **Back office** | Leads the advisor handed over, a propensity ranking and demo controls |

## Run it

You need Node 20.9 or later, and the data pack in `YTL_TrackA_Udyam_Digital_Data/`, which stays out of git.

```bash
npm install
```

```bash
npm run setup:env
```

```bash
npm run db:migrate
```

```bash
npm run seed
```

```bash
npm run setup:ocr
```

```bash
npm run dev
```

Then open http://localhost:3000 at phone width. `npm run setup:env` creates `.env.local` with fresh secrets. For the advisor to read free text, add a free [Google AI Studio](https://aistudio.google.com) key to it as `LLM_API_KEY`. Without one, the journey still works on tappable answers and the short form.

The back office is at `/backoffice`, and asks for `ADMIN_TOKEN` from `.env.local`.

**Dates:** business checks use the case's fixed date of 15 July 2026 through `APP_TODAY`, so tracker dates show July 2026.

**A test run:** answer the advisor's questions, accept the quote, use the test code shown on screen, and upload `K03_*.png` from the data pack. Use the contact name from `tests/fixtures/kyc/specimens.json`. K03 is verified, and K01, K04, K06, K07, K10 and K11 show the other outcomes.

## Tests

| Command | Covers |
|---|---|
| `npm test` | Unit, data regression, API integration and advisor scenarios with a mocked LLM |
| `npm run test:e2e` | Browser journeys at 360 px in English and Hindi, K01 to K12 with real OCR, a failing LLM, an OCR outage, accessibility checks |
| `npx tsx scripts/advisor-live-eval.ts gemini-3.5-flash-lite` | Our scenarios on a real model. Spends free quota |
| `npx tsx scripts/advisor-live-conversations.ts http://localhost:3000` | Full conversations with a running app. Spends free quota |
| `npx tsx scripts/ocr-phone-sim.ts` | OCR on simulated phone photos |
| `npm run test:qa:logic` | Awkward advisor and quote logic |
| `npm run test:qa:browser` | Awkward journeys in the browser. Run `npx next build` and `npx tsx tests/qa/start-server.ts` first |

Browser tests need `npx playwright install chromium` once.

## Where things are

| Path | What |
|---|---|
| `src/domain` | Pure rules: eligibility, pricing, recommender, KYC checks, order stages |
| `src/server` | Database, adapters, LLM, services and guards |
| `src/app`, `src/components` | Routes and screens |
| `src/i18n` | English and Hindi wording |
| `analytics` | Python scripts behind every number in the business case |
| `docs/architecture` | [Solution architecture](docs/architecture/solution-architecture.svg) and [API reference](docs/architecture/api.md) |
| `docs/privacy-note` | The 1-page privacy and security note |
| `docs/blueprint.md`, `docs/decisions-for-you.md` | Plan, status and open decisions |

## Hosting

This app needs a server, because it holds a database, runs OCR, stores encrypted documents and keeps the LLM key secret. So it can't run on a static host such as GitHub Pages as built. Hosting is still to be decided, and any host needs Node and a persistent disk.
