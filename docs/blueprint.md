# Project Udyam Digital: delivery blueprint

## Context

We are entering Airtel SYNC, Track A. The folder holds the case, the data pack, the skills and the agents, but no application code yet. We need a plan from now to judging that names the major challenges in each phase and how to handle them.

**What you confirmed**

- Less than a week remains. The exact date is still to be checked.
- You are building alone with Claude.
- No paid LLM API key is available, which replaces the earlier assumption of a Claude key. See [decisions-for-you.md](decisions-for-you.md).
- We don't yet know how judges will run their live scenarios.

This is a blueprint, so most choices stay open. Each one has a working default and a date to decide by, listed in the [decision register](#decision-register). Candidate answers are starting points, not decisions.

## What the data changes

I reproduced the baselines from `smb_leads.csv`: 7.36%, ₹15,053, 17.6 days, 3.01 chases, 15.2% churn and a ₹6,900 median bundle. These further findings shape the plan:

| # | Finding | Consequence |
|---|---|---|
| 1 | **The steepest funnel drop is mostly about price.** Of 1,113 drops after needs assessment, 621 (56%) cite price or a cheaper competitor. Only 385 (35%) cite a slow or complex quote. | A clearer quote alone won't recover most of them. We also need a pricing answer. |
| 2 | **Value isn't where the leads are.** Micro is 54% of leads and 6% of monthly bundle value. Multi-site is 15% of leads and 57% of value. | Segment order should follow economics, not lead count. |
| 3 | **"One sitting" covers buying, not installing.** About 13 of the 17.6 days pass before KYC completes. The longest catalogue install in a bundle averages 7.6 days, or 19.6 for manufacturers. | Set time-to-activate targets by segment. |
| 4 | **The catalogue and history disagree on install time.** The catalogue averages 7.6 days, but the historic gap from KYC to activation averages 4.8. | State which basis each target uses. |
| 5 | **Digital channels convert worst today.** Website is 4.3% and WhatsApp 2.8%. Field and partners take 85% of spend for 56% of activations. | Digital can't simply replace people on current numbers, which supports an assisted role. |
| 6 | **Some owners need less, not more.** 280 only wanted a mobile plan, 107 decided to wait and 325 were locked in with a provider. | The advisor must allow a single product, a saved quote and a later reminder. |
| 7 | **The K10 check needs a contact name from outside the documents.** The registries have no contact field, and 3,066 lead rows repeat an earlier business name. | The journey must capture the contact name, or K10's mismatch can't be detected. |
| 8 | **KYC can invalidate the quote.** An owner can say they have a GSTIN and then turn out to be Cancelled, as in K01. | KYC must re-run eligibility and ask the owner to accept the changed quote. |
| 9 | **The churn label can't be fully observed.** Every activation falls within 6 months of "today", and 16 fall after it. | Use the label as given, with a footnote in the deck. |
| 10 | **The deck template is minimal.** It has a title slide and a blank body slide with logos in the background image, and no placeholders. | Allow time for layout. `python-pptx` and LibreOffice aren't installed. |
| 11 | **Field visits to micro are the clearest waste.** They take 25.8% of all spend for 7.3% of activations, at ₹53,026 each. | Point the field force at multi-site and manufacturers. See [the numbers](business-case/numbers.md). |
| 12 | **Tamil, Punjabi and Kannada leads convert at 4.7%, against 8.0% for Hindi and English,** even after adjusting for segment. | Regional-language chat has real support, though only a live test would show cause. |
| 13 | **Existing Accel mobile customers are 30% of leads and convert best,** at 9.2%. | Start the rollout with this warm base. |

## Schedule

This assumes 6 working days. Re-fit it as soon as the deadline is confirmed.

```
P0 --+-- P1 ------------------------------+
     |                                    |
     +-- P2 -- P3 --+-- P4 --+            |
                    +-- P5 --+-- Gate -- P8 -- P9 -- P10
                    +-- P6 --+     |
                                   +-- P7 (only if on time)
```

| Phase | Effort | Days | Who does the work | Exit gate |
|---|---|---|---|---|
| 0 Confirm and de-risk | 0.5 day | 1 | Main session | Deadline known, OCR accuracy measured, test deploy reachable |
| 1 Business numbers | 0.5 day | 1 | Main session, `msme-analytics` | Numbers come from a script, candidates chosen |
| 2 Rules core | 1 day | 1–2 | `backend-engineer`, `msme-advisor` | 368 of 368 setup fees and contracts match, exactly 56 flagged |
| 3 Walking skeleton and trust layer | 1 day | 2–3 | `backend-engineer`, `frontend-engineer` | Stubbed journey runs on the hosted URL |
| 4 Advisor | 1–1.5 days | 3–4 | `ai-engineer`, `msme-advisor` | Own 15+ scenarios pass, and the journey completes with the LLM off |
| 5 Quote, order and tracker | 0.5–1 day | 3–4 | `frontend-engineer`, `backend-engineer` | Toggle and tracker edge cases pass |
| 6 Smart KYC | 1.5 days | 3–4 | `kyc-specialist`, `smart-kyc` | K01 to K12 give the expected check IDs |
| **Gate at end of day 4** | | | You | The real journey works end to end, so decide on P7 |
| 7 Stretch (optional) | up to 0.5 day | 5 | `frontend-engineer`, `msme-analytics` | Only if the gate passes |
| 8 Harden and freeze | 1 day | 5 | `qa-engineer`, `security-reviewer` | Full suite and failure drills pass, code frozen |
| 9 Submission pack | 1 day, drafts from day 1 | 5–6 | Main session, document skills | All 4 deliverables uploaded |
| 10 Live judging | | After submission | You | Rehearsed against unseen scenarios |

**Your time is the main limit.** Only you can do these:

- Check the deadline on the platform.
- Make the decisions at each gate.
- Review the Hindi, or find a native speaker who can.
- Record the video.
- Upload the submission.

---

## Phase 0: Confirm and de-risk

**Goal:** replace the riskiest unknowns with facts before building on them.

**Work:**

- Check the deadline, time zone, upload limits and demo format on the platform.
- Run `git init`, add `.gitignore` and scaffold the app.
- Add the API key to `.env.local`.
- Run the throwaway OCR and hosting tests.
- Install `python-pptx` and Playwright when they are needed.

| Major challenge | How we address it |
|---|---|
| **The deadline is short and unconfirmed.** The pack gives no date. | Check it first. Freeze code 24 hours before the deadline and plan backwards from there. |
| **OCR accuracy was the biggest technical unknown.** Watermarks cross the values, K02 is rotated, K04 is blurred and addresses wrap mid-word. | **Tested on 2026-11-04.** `tesseract.js` read 96.8% of fields, or 99.2% with GSTIN repair, against the proposed 90% bar. Phone photos are untested. See [the results](spikes/ocr-accuracy.md). |
| **The stack may not suit serverless hosting.** A SQLite file, encrypted documents, OCR workers and a retention job all need a long-running server with a disk. | Deploy a small test container with a persistent volume on day 1 (Docker is installed). Keep a team laptop ready as backup. |
| **A public URL exposes the LLM budget.** | Set a spend cap on the key, a limit on turns per session and a rate limit on advisor messages. |
| **The stack isn't confirmed, and there is no time to change it twice.** | Keep the proposed stack, because the skills and agents assume it. Check on day 1 that `libsql` and `sharp` install on Windows. |
| **The data pack should be treated as real data, but the repo goes to judges.** | Default: keep the leads and KYC images out of git, and have seeds read from a configured folder. Confirm what the platform expects. |

**Exit gate:** the deadline is in `CLAUDE.md`, the OCR accuracy table exists, the test deploy is reachable and one live Claude call succeeds.

---

## Phase 1: Business numbers

**Goal:** answer questions 1, 4 and 5 with figures that a script reproduces. The bundle candidates also feed the advisor's ranking. This phase runs alongside Phase 2.

| Major challenge | How we address it |
|---|---|
| **Micro is the largest group and the weakest economically.** It takes 8.1 months of median revenue to recover acquisition cost, churn is 22.7% and 47% have no GSTIN. The case still features kirana stores. | Sequence by economics and offer micro a digital-only route with no field visits. A low-cost journey is what could make micro viable. See the [candidates](#starting-candidates). |
| **Price is the main drop reason, and a digital journey doesn't change price.** | Test starter bundles, compare the quote with the owner's current spend, and consider funding an introductory offer from saved acquisition cost. State every assumed recovery rate. |
| **Targets must survive questioning.** | Build a funnel model with low, base and high cases. Name which drop reasons it recovers and at what rate. |
| **Time-to-activate depends on product mix.** Leased lines take 21 to 30 days. | Set targets by segment, and state whether each uses catalogue or historic install time. |
| **Field and partner roles have no commission data behind them.** | Propose attribution codes, an assisted mode on the same journey and human handoff for what the advisor can't close. Label commission figures as assumptions. |
| **There is no cost data, so margin can't be calculated.** | Report payback in months of revenue, and label any margin figure as an assumption. |
| **Associations can mislead.** Some groups are small. The GSTIN gap holds within segments (6.3% against 1.6% for micro), so segment mix doesn't explain it away. | Control for segment, write "is associated with", and avoid conclusions from small groups. |

**Exit gate:** the script reproduces the funnel and ₹15,053, and every deck number traces to a script.

---

## Phase 2: Rules core

**Goal:** build catalogue loading, eligibility, pricing and identifier validation as pure, tested code.

| Major challenge | How we address it |
|---|---|
| **The rules have sharp edges.** AirFiber isn't a valid base for failover, SD-WAN, Static IP or the firewall. Leased lines aren't a valid base for Static IP or Secure Wi-Fi. Cancelled and Suspended GSTINs count as none. | Write table-driven tests first, covering every rule at, below and above its boundary. Load rules from the CSV at runtime. |
| **Removing a base product strands its dependents.** | Add a cascade function that returns what was removed and why, unless another valid base remains. |
| **The catalogue says what can be sold, not what should be.** | Build a deterministic recommender: map needs to products, ask about fibre availability, and use AirFiber where there is none. Use historic bundles only for sanity checks, after filtering the 56 that break a rule. |
| **Prices are ranges, but the owner needs one number.** | Use one midpoint constant. Cloud Email's midpoint is ₹137.50, so it also needs an explicit rounding rule to stay in whole rupees. Test that every unit price stays inside its range. |
| **Toggles change more than price.** The bundle takes its longest contract and install time, so adding Managed Firewall can move a contract from 12 to 24 months. | Return the changes in contract, setup fee and install date with every recalculation, so the screen can show them. |
| **Multi-site businesses may differ by site.** Fibre may reach some sites and not others. | Default: one configuration across all sites. Hand off to a person when sites differ. |

**Exit gate:** 368 of 368 setup fees and contracts match, exactly 56 bundles are flagged, and the unit tests pass.

---

## Phase 3: Walking skeleton and trust layer

**Goal:** have a thin journey running end to end on the hosted URL, using a templated advisor and mocked OCR. We then always have something we could submit, and the agreed interfaces let the next phases run in parallel.

| Major challenge | How we address it |
|---|---|
| **There is too much platform to build in a week.** | Build only what the four modules call. Simple versions are fine, such as an in-memory rate limiter. The security and privacy non-negotiables in `CLAUDE.md` stay. |
| **Consent must not break "one sitting".** | Let the advisor run with a short notice and business facts only. Ask for a phone number only when the owner accepts a quote. Show the full KYC notice later, with unticked purposes and server enforcement that returns 403. |
| **The app has two clocks.** Business checks use 15 July 2026, but sessions and audit logs need real time. Tracker dates will also show July 2026. | Give `Clock` a separate business date and system time. Test the 90- and 91-day boundaries, including across IST and UTC. Explain the date in the demo. |
| **The journey must survive failure.** | Keep journey state on the server, save at every step and provide a way to resume. |
| **Encryption and retention need to be real.** The privacy note will claim them. | Add a small AES-256-GCM helper and an in-process retention job with a manual trigger and a test. |
| **Hindi becomes painful if added late.** | Use message catalogues from the first screen. Load fonts by locale and allow for strings 40% longer. |

**Exit gate:** the stubbed journey works at 360 px on the hosted URL. Missing consent returns 403, another owner's object returns 404, and the registry returns 200, 400, 404 and 503.

---

## Phase 4: Advisor

**Goal:** a conversational advisor that discovers needs and explains the result, while code decides everything that matters.

| Major challenge | How we address it |
|---|---|
| **Judges run 15 unseen scenarios live.** | Write at least 15 of our own from the catalogue rules, drop reasons and segments. Run each live at least 3 times, in English and Hindi, and record pass rates. Never seek the judges' pack. |
| **An LLM varies, but rules must not.** | The LLM extracts and explains, and code decides. Prices and product names come from cards and slots rendered by code, so the model never types a price. A guard also catches digits, Devanagari numerals and number words, then retries once and falls back to a template. |
| **Owners use Hindi, Hinglish and language switching.** Other regional languages cover about a third of leads. | Test romanised input and mid-chat switching. UI stays English and Hindi. Chat may answer in other languages if it passes testing, and we describe it accurately. |
| **Free text can contain identifiers.** An owner may paste a GSTIN or phone number. | Remove identifier patterns before any LLM call and in stored chat. Never ask for names in the advisor. |
| **Forcing a bundle loses some owners.** | Allow a single product, save a quote for later and offer a reminder with consent. See finding 6. |
| **Off-script input is likely to be tested.** Examples are discount demands, insisting on a blocked product, rule-bypass attempts, contradictions and refusing to share details. | Follow the off-script table in `msme-advisor` and test each row. The defence is structural, because no tool can bypass a rule. |
| **Reasons must be true.** | Derive each item's reason from the need it maps to. The LLM only rephrases it. |
| **The LLM can be slow or down on a phone connection.** | Stream replies, use prompt caching and trim history. On timeout, move to a guided form that calls the same domain code. Build this path first. |

**Exit gate:** own scenarios pass with a mocked LLM, live pass rates are recorded, invented prices never reach the owner, and the journey completes with the LLM off.

---

## Phase 5: Quote, order and tracker

**Goal:** one transparent monthly price, then a status view that replaces the three chase calls.

| Major challenge | How we address it |
|---|---|
| **Toggles need server-side prices on a patchy network.** | Update the screen immediately, then reconcile with the server's result. Show blocked add-ons as disabled, with the reason. |
| **"One transparent price" conflicts with unknown tax.** The catalogue doesn't state tax treatment. | Default: label prices "excl. GST". Any estimate of the tax is a labelled assumption. |
| **Checkout has no real payment.** 28 historic drops were failed first payments. | Default: a clearly labelled mock payment after KYC, with no card data collected, plus a failure and retry path. |
| **Nothing real moves the order forward.** | Add an admin-only control to advance stages, labelled as a simulation. Calculate dates per product from `typical_install_days`. |
| **The tracker must actually stop the calls.** 98 drops came from installs over 21 days and 41 from fibre not being feasible. | Put "what happens next and when" above the fold. Show delays with a reason and new date, offer AirFiber when fibre isn't feasible, and show status messages as a mock log under `service_updates` consent. |

**Exit gate:** toggling off a base warns and removes its dependents, contract changes are shown, and failed payment and delayed install both recover. Another owner's order returns 404.

---

## Phase 6: Smart KYC

**Goal:** near-instant verification that catches the planted problems, passes the clean applicants and honours consent.

| Major challenge | How we address it |
|---|---|
| **The answer key is hidden, and our reading may differ.** The K01 to K12 table is our own, and K05 and K07 have no settled verdict. | Show the specific check and message, so correct detection is visible whatever the label. Keep one verdict policy table and settle K05 and K07 there. |
| **False rejections hurt as much as misses.** | K03, K08, K09 and K12 must pass. Udyam date and activity stay soft checks. |
| **OCR errors can look like real mismatches.** K02's O/0 is an OCR confusion, and K06's altered digit is a planted fault. K10's `I` for `J` misread also fails the checksum, exactly as K06 does. | Repair a character only where its position requires another type and the checksum then passes. Never repair towards a registry value. A checksum failure on an OCR value goes to the owner to confirm first, so K10 continues and K06 still ends in rejection. |
| **The images are awkward.** They have blur, skew, watermarks, wrapped addresses, proprietor name formats and a different ID layout. | Use the settings the OCR test supports: no watermark filter, `tesseract.js` auto-rotation, a blur gate and parsing by label. Test phone photos of the specimens, because only clean digital images have been measured. |
| **OCR can make "near-instant" slow.** | Ask for the number first and skip what a lookup proves. Reuse workers and show progress per document. Bundle language data locally, because `tesseract.js` otherwise fetches it from a CDN by default, which would break the local-processing claim. |
| **K10's check has no contact name to compare against.** | Ask for the contact's name when the application starts, and prefill it for a matched seeded lead. Match leads on GSTIN, not business name. |
| **KYC can change the quote.** | Re-run eligibility, show what changed and ask the owner to accept again. A no-GSTIN bundle stays available. |
| **A registry can be down.** | Add an interim "verification pending" state, retry automatically and let the owner leave and come back. Put the outage switch behind admin access. |
| **Privacy runs through the whole pipeline.** | Require consent before upload. Check file contents, strip EXIF, re-encode and encrypt. Never log OCR text or send it to the LLM. Withdrawal starts deletion. Treat DigiLocker and e-sign as interfaces and deck content unless time remains. |

**Exit gate:** K01 to K12 give the expected check IDs with mocked OCR, a live OCR accuracy report exists, missing consent returns 403 and repeat uploads are idempotent.

---

## Gate at the end of day 4

Run one real journey on the hosted URL in Hindi, from advisor to tracker, using a clean specimen and a failing one. If that fails, skip Phase 7 and move to Phase 8.

## Phase 7: Stretch (optional)

**Goal:** add what most improves the answers to the case questions, only after the core works.

| Major challenge | How we address it |
|---|---|
| **Stretch work can endanger the core.** | Time-box it to half a day, in this order: a read-only back-office table of advisor handoffs with reasons, then a propensity score. Skip voice and real WhatsApp, because neither fits in a week. Browser speech services may also send audio to third parties, which the privacy note would have to cover. |
| **Propensity scores can leak future data.** | Use only fields known at lead creation. Train on April and May and test on June. Report PR-AUC and top-decile lift. |
| **Language and state could look discriminatory in a score.** | Compare the score with and without them, and drop them if they add little. |
| **The back office increases exposure of personal data.** | Use a separate role, mask identifiers, show no raw documents and keep KYC data out of scoring. |

**Exit gate:** the core journey still passes its tests.

---

## Phase 8: Harden and freeze

**Goal:** make the demo reliable and every claim true.

| Major challenge | How we address it |
|---|---|
| **Defects appear where modules meet.** | Run Playwright over the full journey at 360 px, in English and Hindi, with `axe`. |
| **Failure handling is easy to assume and hard to prove.** | Run drills with the LLM, registry and OCR each switched off. Each must complete or resume. |
| **Live LLM tests are flaky.** | Mock the LLM in browser tests and run a separate live pass. |
| **Privacy and security claims may not match the code.** | Run `security-reviewer` and `npm audit`, then fix or disclose each finding. |
| **The app may struggle on a mid-range phone.** | Test on throttled 4G, load fonts by locale and shrink images before upload. |
| **A late change can break the demo.** | Freeze code 24 hours before the deadline and allow fixes only. Add a demo reset script. |
| **Claude Code usage limits could hit during the final push.** | Do heavy subagent work early, and keep the final day mostly recording and uploading. |

**Exit gate:** the full suite output is quoted, drills pass, there are no serious `axe` findings and the security findings are resolved or disclosed.

---

## Phase 9: Submission pack

**Goal:** all four deliverables within their hard limits, uploaded early.

| Deliverable | Major challenge | How we address it |
|---|---|---|
| **Demo video, 3 minutes** | Four modules, edge cases and Hindi have to fit in 3 minutes. | Use the [shot list](#video-shot-list) and record a safety take on day 5. `ffmpeg` isn't installed, so use the Clipchamp app that comes with Windows 11 to edit. |
| **Architecture diagram** | It must match the code and show data flows. | Draft after Phase 3 and finalise after the freeze. Show the trust boundary and exactly what reaches the LLM. |
| **Business case, 10 slides** | The template has no placeholders, and there's no local renderer. | Build a skeleton after Phase 1 using [this outline](#deck-outline). Install `python-pptx`, then check the layout in PowerPoint if you have it, or by uploading to Google Slides. Cite a script for every number. |
| **Privacy note, 1 page** | Every line must be true of the code, and legal citations must be right. | Draft after Phase 3. Check the current DPDP text before citing it. State the limits: mock OTP, mock registries, the LLM provider as a processor and its region. |
| **Code repository** | Judges must be able to run it, and it must contain no secrets or documents. | Write a README with a single run command and an `.env.example`, then scan for secrets. |

| Other challenges | How we address them |
|---|---|
| **Everything can land on the last day.** | Draft from day 1 and upload a complete version 24 hours early, if the platform allows replacing it. |
| **The platform may have format limits.** | Check them on day 1. |
| **Simulated results could look like measured ones.** | Label modelled and prototype figures separately from the April to June baseline. |
| **Brand mix-ups are easy to make.** | Use "Accel Business" in the product. Airtel and SYNC marks appear only on the organisers' template. |

**Exit gate:** all four are uploaded and confirmed on the platform, and the limits are checked: video under 3:00, 10 slides or fewer, one page.

---

## Phase 10: Live judging

**Goal:** stay reliable when judges try things we haven't seen.

| Major challenge | How we address it |
|---|---|
| **Unseen scenarios arrive live.** | Rehearse with scenarios you didn't write, from a friend or a fresh Claude session playing the judge. |
| **The venue network or a service could fail.** | Have the hosted URL, a laptop copy and a phone hotspot ready. Warm up OCR beforehand and keep the reset script to hand. Know how to reach the LLM-off path. |
| **Judges may hand over specific documents.** | Keep all specimens on the demo device and rehearse each of K01 to K12. |
| **Judges will probe the choices.** | Prepare short answers on the midpoint price, soft Udyam checks, the acquisition cost definition, what is mocked and what production would need. |

**Exit gate:** one full rehearsal with unseen scenarios, on the actual demo setup.

---

## Decision register

| # | Decision | Working default | Decide by | What would change it |
|---|---|---|---|---|
| 1 | Hosting | Container with persistent disk, laptop as backup | Phase 0 | The demo format on the platform |
| 2 | OCR engine | **Decided: local `tesseract.js`**, 96.8% on the specimens | Done | Phone photos proving unreadable in Phase 6 |
| 3 | Data pack and repo visibility | Pack kept out of git, repo private until submission | Phase 0 | Platform rules |
| 4 | Segment order | See candidates below | Phase 1 | The funnel model |
| 5 | KPI targets | See candidates below | Phase 1 | The funnel model |
| 6 | Price position | Midpoint for all segments | Phase 1 | Evidence that a lower price suits micro |
| 7 | Advisor consent | Short notice before chat | Phase 3 | Privacy review |
| 8 | Retention periods | The defaults in `privacy-security` | Phase 3 | Privacy review |
| 9 | LLM model | In config, chosen by scenario results | Phase 4 | Pass rate, speed and cost |
| 10 | Chat languages | English and Hindi, others if they pass testing | Phase 4 | Live test results |
| 11 | Tax display | "excl. GST" label | Phase 5 | Your preference |
| 12 | Payment | Mock, after KYC, with no card data | Phase 5 | Your preference |
| 13 | K05 and K07 verdicts | Built: K05 is verified using the registry, K07 goes to manual review | Phase 6 | Further reading of the specimens |
| 14 | Contact name source | Owner enters it, prefilled for matched leads | Phase 6 | Data minimisation review |
| 15 | Stretch goals | Back office, then propensity | Day 4 gate | Time left |

## Cut order if time runs short

Cut in this order:

1. Propensity score
2. Back-office view
3. Chat in languages beyond Hindi and English
4. Mock status message log
5. Per-product tracker detail, keeping one overall date
6. Phone-photo robustness, keeping the provided specimens

**Never cut:**

- The four modules
- Code-decided rules and prices
- Server-enforced consent, and masking
- Hindi
- The LLM-off path
- The four deliverables

**If only 3 to 4 days remain:** Phase 1 only reproduces the baselines and picks segments, Phase 7 is dropped, and the first three cuts apply from the start.

## Where each case question gets answered

| Question | Built or analysed in | Shown in |
|---|---|---|
| 1 Segments, bundles, price and contract | Phases 1, 2 | Deck slides 3–4 |
| 2 Discovery without a salesperson | Phase 4 | Video, live scenarios |
| 3 Near-instant KYC under DPDP | Phases 3, 6 | Video, privacy note, deck slide 6 |
| 4 Field force and partners | Phases 1, 7 | Deck slide 7, back office if built |
| 5 Metrics and targets | Phase 1 | Deck slide 8 |

## Starting candidates

These are for testing in Phase 1. They aren't decisions.

### Segments and bundles

Prices are hand-calculated at the midpoint, excl. GST, and haven't yet been run through code. The quantities are examples.

| Wave | Segment | Why | Route | Example bundle |
|---|---|---|---|---|
| 1 | Professional offices | 11.1% activation, 1.6-month payback, 86% have a GSTIN, mostly one site | Fully digital | Fibre 300, 2 Postpaid 599, 8 email users, 7 endpoint licences, Cloud Backup: **₹5,618/month**, no setup fee, 12 months |
| 1 | Small multi-site | 57% of bundle value, 0.6-month payback, 98% have a GSTIN | Digital quote, a person confirms site feasibility | 8 sites of Fibre 300 with failover, 3 Postpaid 599, 3 POS counters, 4 cameras: **₹22,924/month**, ₹26,700 setup, 12 months |
| 2 | Micro retail and services | 54% of leads but 8.1-month payback and 22.7% churn | Digital only, no field visits | Fibre 100, 1 Postpaid 299, Secure Wi-Fi: **₹1,947/month**, ₹1,000 setup, 12 months, no GSTIN needed |
| Assisted | Small manufacturers | 12.8% activation, 1.0-month payback, long installs, low price sensitivity | Field-led, the advisor qualifies | Leased Line 20, Managed Firewall, 3 Postpaid 599, 10 email users, 10 endpoint licences: **₹17,216/month**, ₹14,000 setup, 24 months |

### Metrics

Modelled low, base and high cases now come from `analytics/impact_model.py`. See [the numbers](business-case/numbers.md) for the assumptions and what the result rests on.

| KPI | Baseline | Candidate target | Modelled low, base, high |
|---|---|---|---|
| Lead-to-activation | 7.36% | 15% | 9.9%, 15.6%, 24.9% |
| Time to activate | 17.6 days | 10 days or less overall, shown by segment | 13.5, 9.8, 6.4 days. Manufacturers stay near 20 |
| Acquisition cost | ₹15,053 | ₹7,000 or less | ₹11,253, ₹6,194, ₹3,307 |
| Status chases | 3.01 | 1 or fewer | Not modelled. Tracker and proactive updates |
| 6-month churn | 15.2% | 12% or less | Not modelled, and the least certain. More chase calls are associated with higher churn, but this isn't shown to be causal |

**Guardrails:** rule-breaking bundles go from 56 of 368 to zero, activations on inactive GSTINs from 22 to zero, and false rejections on the four clean specimens stay at zero.

### Field force and partners

- **Field and partners** handle what the advisor can't close: multi-site, leased lines, feasibility and owners who need help.
- **Assisted mode** puts a partner beside the owner on the same journey, seeing masked data and no raw documents.
- **Attribution codes** mean a partner still gets credit if the owner finishes alone, so digital doesn't compete with them.
- **Field time** goes to high-value and high-propensity leads, since field and partners take 85% of spend today.

### Deck outline

1. Title
2. The problem, and where the funnel leaks
3. Which segments come first, and why
4. Bundle, price and contract per segment
5. The journey, with product screenshots
6. Near-instant KYC under DPDP
7. Field force and partner role
8. KPI targets with low, base and high cases
9. Rollout plan
10. Risks and what we need to proceed

### Video shot list

| Time | Show |
|---|---|
| 0:00–0:15 | The problem in numbers |
| 0:15–1:00 | Advisor in Hindi, including a blocked product explained, such as WhatsApp without a GSTIN |
| 1:00–1:25 | Quote: an add-on toggle, then removing a base product |
| 1:25–2:10 | Consent, one applicant passing and one planted failure |
| 2:10–2:30 | Tracker: what happens next and when |
| 2:30–2:50 | The journey continuing with the LLM off, and the back office if built |
| 2:50–3:00 | Expected impact and the privacy stance |

## Risks across every phase

| Risk | How we address it |
|---|---|
| **One person reviewing everything** | Gate on test output rather than reading every line. An agent's report isn't proof, so check the diff and results at each exit gate. |
| **Docs drifting from code** | Update `CLAUDE.md` when a decision changes, and do a final check of the note and diagram against the code. |
| **Scope creep** | Use the cut order. New ideas go in a list unless they replace something. |
| **Reliance on our own reading of the specimens** | Keep the fixtures marked as ours, and never seek or use the judges' pack. |

## How we'll know it's on track

**Checked while writing this blueprint:**

- The baselines and the findings table, recomputed from the data pack
- The template structure
- Which tools are installed

**Not yet tested:**

- OCR on phone photos
- Hosting
- `libsql` and `sharp` on Windows
- Live advisor quality
- The candidate prices and targets

Each phase has an exit gate. Per `CLAUDE.md`, nothing counts as done until the relevant tests are run and their results quoted. Before the demo, we run the full suite, a live scenario pass and the journey with the LLM and registry switched off.

## Next steps

Phase 0 status on 2026-11-04:

| Item | Status |
|---|---|
| Git repository and ignore rules | Done, with nothing committed |
| OCR accuracy test | Done |
| Deadline, upload limits and demo format | **Yours to check on the platform** |
| API key in `.env.local` and one live call | **Yours to add the key**, then the call can be tested |
| App scaffold and Windows install check | Done |
| Test deploy | Not started, because it needs a host chosen |

Phase 2 status on 2026-11-04: rules core built in `src/domain`, and its exit gate is met. All 368 setup fees and contracts match, exactly 56 bundles are flagged, and 15 deliberate breaks to the rules were all caught by the tests.

Phase 1 status on 2026-11-04: scripts in `analytics/` reproduce the funnel and ₹15,053 and write the [business numbers](business-case/numbers.md). Segment order and targets are still candidates for you to confirm.

Phase 6 status on 2026-11-04: KYC parsing, checks and verdicts are built in `src/domain/kyc`, and K01 to K12 give their expected results on real OCR output. The upload pipeline, consent gate and screens aren't built yet.

Phase 9 status on 2026-11-04: paused at your request. The final deck gets made once the product is finished. An early draft and its script sit in `docs/business-case`, uncommitted. The other deliverables haven't started.

Timeline update on 2026-11-04: the team now says there is enough time, so the 6-day schedule above is no longer a limit. The phase order and exit gates still apply.

Open items for you are in [decisions-for-you.md](decisions-for-you.md).

Nothing gets committed or pushed unless you ask.
