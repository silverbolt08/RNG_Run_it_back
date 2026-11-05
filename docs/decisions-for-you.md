# Waiting for you

The app is built and runs end to end, so nothing here blocks further work.

## Settled

| Item | Answer |
|---|---|
| Deadline | The team says there is enough time. No exact date recorded |
| Team name | RNG |
| Deck | Paused until the product is finished. A draft and its script sit in `docs/business-case`, and aren't committed |
| Prices | Show the final price including tax. Assumes catalogue prices exclude GST, and that GST is 18% |
| LLM | Gemini on a free key, with `gemini-3.5-flash-lite` first. See [the test results](spikes/llm-choice.md) |
| Segment order | Professional offices and multi-site first, micro digital-only, manufacturers led by people |
| Targets | 15% activation, ₹7,000 acquisition cost, 10 days, 1 chase, 12% churn |
| Impact assumptions | As in `analytics/impact_model.py`, with 60% of leads adopting the digital journey. They're judgement, not evidence, and the deck must say so |
| Test data | `tests/fixtures/kyc/specimens.json` stays in the repo. It holds text from the fictional specimens, and the data pack stays out |
| Payment | Labelled mock payment after KYC, with no card data |
| Stack | Server-based Next.js as built. Deployment is decided later |

## Decisions for you

| # | Decision | Current default | Why it needs you |
|---|---|---|---|
| 1 | **Hosting** | Runs on a laptop for now. It needs a host with Node and a persistent disk, so GitHub Pages won't work | Decides the demo URL. Judges run scenarios live, so a laptop on a hotspot is a real risk |
| 2 | **Gemini's unpaid terms** | Use them, with the notice telling owners that Google may reuse chat and its reviewers may read it | All data here is synthetic, but judges will read the note. A paid tier would remove this limit, and you said one isn't possible |

## Only you can do these

| Item | Why it matters |
|---|---|
| **Review the Hindi**, or find a native speaker | I drafted all of `src/i18n/hi.json`, and I can't vouch for how it reads to an owner |
| **Record the exact deadline and upload limits** when you have them | Sets the freeze date |
| **Record the demo video** | The script is in the blueprint's shot list. 3 minutes at most |
| **Ask for the final deck** when you're happy with the product | You asked to make it last |
| **Rotate the Gemini key** before the repo goes public, if it's ever been shared | It's only in `.env.local`, which git ignores |

## Known gaps

| Gap | Note |
|---|---|
| The mock OTP lets anyone who knows a phone number sign in as that owner | Inherent to a mock, and the privacy note says so |
| PDF uploads are rejected, though `smart-kyc` lists them as accepted | JPEG and PNG work. Rasterising PDFs needs a heavy dependency |
| Real phone photos are untested | Simulated ones read 91.6% to 100% of fields the same as clean scans. See the [OCR note](spikes/ocr-accuracy.md). Try a few real photos before the demo |
| Chat works in any language the model reads, but only English and Hindi have screens and fallback wording | Replies in other languages haven't been tested |
| No local LLM backup | If Gemini is down, the owner continues on tappable answers and the short form |
| The back office's propensity score uses the fields the leads table holds | Turnover, current internet and provider aren't seeded, so the live ranking is rougher than the model tested in `analytics/propensity.py` |
| The content security policy has no script nonce | Noted in `next.config.ts`. A production hardening step |

## Security review

A read-only review found no critical issues, 2 high and 7 medium. All of those are fixed, with tests where behaviour changed, and they are:

- Gaps in identifier removal, including spaced numbers, Hindi digits and UPI IDs
- GSTIN confirmation, which could overturn a rejection or look up a stranger
- The reply guard, which missed spelled-out amounts and promises
- Consent, which could be granted without its notice, and an AI clause bundled with the short form
- Retention wording and timing, rate limit bypass, and ID numbers kept with no use for them

Left open, because they are low risk or need a decision:

| Item | Why it's open |
|---|---|
| Owners can overwrite their own contact name to clear a signatory mismatch | The change is audited, but a real product would send it to a person |
| A name typed as a business type or city can reach the back office | It shows facts read from chat, and mapping every value to a known list would refuse real businesses |
| The guard covers amounts in words in English and Hindi only | Numerals are caught in every script, and the brief holds no numbers. Other languages are untested anyway |
| 15 fictional GSTINs from the pack sit in tracked test files | Your test data decision. Check the platform's rules before a public push |
| 12 moderate `npm audit` findings in development tools | None in production dependencies |

## Choices I made that you may want to check

| Choice | Reasoning | Where |
|---|---|---|
| GST is 18%, on prices assumed to exclude it, shown as final prices | You asked for the final price, and the catalogue doesn't state tax | `src/domain/pricing/pricing.ts` |
| Mock checkout takes the setup fee plus the first month, including GST | A reasonable first payment, but the data doesn't state one | `src/server/services/order-service.ts` |
| Two LLM steps per message: one reads facts, and another words a brief without seeing the owner's text | A prompt injection in chat then has nothing to work on when the reply is written. It costs two calls a message | `src/server/services/advisor/advisor-service.ts` |
| A simple answer, such as a number or a known city, skips the LLM | Saves free quota, and keeps working when the LLM is down | `src/domain/advisor/slot-answers.ts` |
| A typed number can't be a price, and the model writes prices only as slots | The strongest way to keep invented prices from owners | `src/server/llm/output-guard.ts` |
| An unknown city asks for metro, large city or small town. A small town is told we don't serve it yet, and goes to a person | The catalogue offers every product only in tier 1 and 2 | `src/domain/advisor/advisor-facts.ts` |
| Documents uploaded during an OCR outage are kept encrypted and read later, in place of manual entry | Typed details couldn't verify a document anyway, and this loses nothing | `src/server/services/kyc/kyc-upload.ts` |
| A name from the leads data is used only after a matching certificate, and never shown | Otherwise typing a GSTIN could reveal a stranger's name | `src/server/services/kyc/kyc-assessment.ts` |
| A blocked add-on returns `200` with `applied: false`, not an error | Toggling is normal use, and the owner needs the reason and the alternatives | `docs/architecture/api.md` |
| The advisor needs the short consent notice before chat starts, and typed chat needs a separate AI consent | The short form then involves no outside AI service at all | `docs/architecture/api.md` |
| An order under manual review can be placed, but is held and can't be paid until cleared. `RETAKE` and `NEEDS_CONFIRMATION` can't order | The owner keeps their place without paying for something that may not go through | `src/server/services/order-service.ts` |
| Fibre is treated as a rule for Fibre 100, 300 and 1G, but not leased lines | The catalogue has no fibre flag, so this is an assumption | `src/domain/eligibility/eligibility.ts` |
| 3 or more sites counts as multi-site, whatever the business type | Matches all 5,000 leads | `src/domain/bundle/segments.ts` |
| Language and state left out of the propensity score | Including them didn't improve it, so they aren't worth the fairness concern | `analytics/propensity.py` |
| TypeScript 5.9, not the latest 7.0, and ESLint 9 | 7.0 is a major rewrite, and I didn't want to risk Next's build. ESLint only runs during development | `package.json` |
