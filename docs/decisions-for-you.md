# Waiting for you

The work continues on the working defaults, so nothing is blocked yet.

## Settled

| Item | Answer |
|---|---|
| Deadline | The team says there is enough time. No exact date recorded |
| Team name | RNG |
| Deck | Paused until the product is finished. A draft and its script sit in `docs/business-case`, and aren't committed |
| Prices | Show the final price including tax. Assumes catalogue prices exclude GST, and that GST is 18% |
| Paid LLM key | Not available, so the advisor uses a free option |

## Decisions for you

| # | Decision | Current default | Why it needs you |
|---|---|---|---|
| 1 | **Free LLM** | Gemini free tier, with a local model as backup, settled by running our scenarios on each | You'd create the free key, and I'd install Ollama and download a model of about 5 GB |
| 2 | **Hosting** | Later, as you said. GitHub Pages only serves static files, and this app needs a server for its database, OCR, encrypted documents and LLM key | Pages would mean a different design, so it's better settled before the screens are finished |
| 3 | **Segment order** | Professional offices and multi-site first, micro digital-only, manufacturers led by people | Shapes the whole business case |
| 4 | **Targets** | 15% activation, ₹7,000 acquisition cost, 10 days, 1 chase, 12% churn | These are the numbers you'll defend to judges |
| 5 | **Impact assumptions** | See `analytics/impact_model.py`. The main one is 60% of leads adopting the digital journey | They're my judgement, not evidence, so please challenge them |
| 6 | **Test data in the repo** | `tests/fixtures/kyc/specimens.json` is committed locally. It holds text from the fictional specimens, and the data pack itself stays out | Matters once the repo is pushed, especially if it's public |
| 7 | **Payment** | Labelled mock payment after KYC, with no card data | Decides what the video shows |

## Only you can do these

| Item | Why it matters |
|---|---|
| **Review the Hindi**, or find a native speaker | I can draft it, but I can't vouch for how it reads to an owner |
| **Record the exact deadline and upload limits** when you have them | Sets the freeze date |

## Choices I made that you may want to check

| Choice | Reasoning | Where |
|---|---|---|
| TypeScript 5.9, not the latest 7.0 | 7.0 is a major rewrite, and I didn't want to risk Next's build | `package.json` |
| ESLint 9, which npm warns is unsupported | It only runs during development, so it can't affect the demo. I haven't tried 10 | `package.json` |
| Fibre is treated as a rule for Fibre 100, 300 and 1G, but not leased lines | The catalogue has no fibre flag, so this is an assumption | `src/domain/eligibility/eligibility.ts` |
| Alternatives beyond those in the `msme-advisor` skill, such as a website when WhatsApp is blocked | Closest product doing a similar job that needs less | `src/domain/eligibility/eligibility.ts` |
| 3 or more sites counts as multi-site, whatever the business type | Matches all 5,000 leads | `src/domain/bundle/segments.ts` |
| Language and state left out of the propensity score | Including them didn't improve it, so they aren't worth the fairness concern | `analytics/propensity.py` |
