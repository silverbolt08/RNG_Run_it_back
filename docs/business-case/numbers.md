# Business case numbers

Every figure here comes from a script in `analytics/`, so it can be re-run and checked. All source data is `smb_leads.csv`, Apr to Jun 2026, and it is synthetic. These scripts stop if the funnel or ₹15,053 fail to tie out.

```bash
python analytics/baseline.py
```

```bash
python analytics/signals.py
```

```bash
python analytics/impact_model.py
```

```bash
python analytics/propensity.py
```

Results land in `analytics/output/` as aggregates, with no names or identifiers.

**Two kinds of number appear below.** Baselines are measured from the data. Anything marked *modelled* rests on our own assumptions, because the prototype has no real customers. Keep that label wherever these appear.

## Baselines

Source: `baseline.json`.

| Metric | Value |
|---|---|
| Lead-to-activation | 7.36% (368 of 5,000) |
| Acquisition cost per activation | ₹15,053 (total spend ₹55.4 lakh) |
| Time to activate | 17.6 days |
| Status chases per customer | 3.01 |
| 6-month churn | 15.2% |
| Median bundle | ₹6,900 a month |

**Churn footnote:** no activation has had six full months by the pack's "today" of 15 July 2026, and 16 fall after it. We use the label as given.

## Where value and cost sit

Source: `baseline.json`, `segments`.

| Segment | Share of leads | Share of activations | Share of bundle value | Activation | Acquisition cost | Payback, months of median revenue | Churn |
|---|---|---|---|---|---|---|---|
| Micro retail and services | 54.2% | 29.9% | 6.1% | 4.1% | ₹20,007 | 8.1 | 22.7% |
| Professional offices | 24.9% | 37.5% | 20.6% | 11.1% | ₹10,695 | 1.6 | 13.8% |
| Small multi-site | 15.1% | 22.6% | 57.0% | 11.0% | ₹15,614 | 0.6 | 10.8% |
| Small manufacturers | 5.8% | 10.1% | 16.3% | 12.8% | ₹15,324 | 1.0 | 8.1% |

Payback is revenue, not margin, because the pack has no cost data.

## Findings

### 1. Field visits to micro businesses are the clearest waste

Source: `impact_model.json`, `field_visits_to_micro`, and `baseline.json`, `segment_by_source`.

Field sales to micro took **25.8% of all spend for 7.3% of activations**: 894 leads, 27 activations and ₹14.3 lakh. That is ₹53,026 per activation, or 21.5 months of median revenue. The same field force on multi-site pays back in 0.6 months.

| Source | Micro | Professional | Multi-site | Manufacturers |
|---|---|---|---|---|
| Field sales | ₹53,026 | ₹16,393 | ₹15,921 | ₹18,182 |
| Channel partner | ₹11,382 | ₹14,198 | ₹42,149 | ₹39,712* |
| Referral | ₹5,760 | ₹2,937 | ₹4,118* | ₹2,031* |
| Inbound call | ₹7,710 | ₹5,157 | ₹3,213 | ₹2,354* |
| Website form | ₹13,124 | ₹3,720 | ₹4,189 | ₹5,240* |

\* Fewer than 10 activations, so treat as anecdote.

This gives the field force a clear role: pull them off micro and point them at multi-site and manufacturers.

### 2. Price is the main reason for the steepest drop

Source: `baseline.json`, `drop_reasons.steepest_drop`.

Of 1,113 drops after needs assessment, 621 (55.8%) cite price or a cheaper competitor. Only 385 (34.6%) cite a slow or complex quote. A clearer quote alone won't recover most of them.

### 3. The GSTIN gap holds within segments

Source: `signals.json`, `gstin`.

| Segment | With a GSTIN | Without |
|---|---|---|
| Micro | 6.3% (n = 1,431) | 1.6% (n = 1,278) |
| Professional | 12.1% (n = 1,074) | 4.6% (n = 173) |

Segment mix doesn't explain it away. Multi-site and manufacturers have too few leads without a GSTIN to read (13 and 2). This is an association. A no-GSTIN route through the journey would test whether the document requirement causes the gap.

### 4. Some regional languages convert worse, even after adjusting for segment

Source: `signals.json`, `language`.

| Language | Leads | Raw | Adjusted for segment |
|---|---|---|---|
| English | 1,168 | 8.0% | 8.0% |
| Hindi | 2,137 | 7.9% | 8.0% |
| Marathi | 505 | 6.3% | 6.5% |
| Gujarati | 233 | 6.0% | 5.9% |
| Kannada | 253 | 5.1% | 5.0% |
| Tamil | 207 | 4.3% | 4.4% |
| Punjabi | 96 | 4.2% | 4.4% |

Tamil, Punjabi and Kannada together convert at 4.7% against 8.0% for Hindi and English (Fisher p = 0.005), and the gap holds in both city tiers. Bengali (9.0%) and Malayalam (8.4%) don't show it, on small samples. We chose these three languages after seeing the data, so the p-value flatters the result. This supports regional-language chat, and only a live test would show whether language is the cause.

### 5. Existing Accel mobile customers are the largest warm base

Source: `signals.json`, `current_provider`.

"Accel (mobile only)" customers are 1,505 leads, 30.1% of the total, and convert best at 9.2%, against 5.4% for local ISP customers. The rollout can start with this base at low cost, because we already hold a relationship with them.

### 6. Referrals are the best channel

Source: `baseline.json`, `channels`.

Referrals convert at 14.8% and cost ₹4,099 per activation, the highest conversion and among the lowest cost. A referral prompt on the tracker would be cheap to test.

### 7. Chase calls are associated with churn

Source: `signals.json`, `chase_calls_vs_churn`.

| Chase calls | Customers | Churn | 95% interval |
|---|---|---|---|
| 1 | 34 | 5.9% | 1.6 to 19.1 |
| 3 | 137 | 11.7% | 7.3 to 18.1 |
| 5 | 43 | 27.9% | 16.7 to 42.7 |

The intervals are wide, but the direction supports the tracker. Slow activation lowers NPS (6.0 over 21 days, against 7.2 at 14 or under), while churn stays flat at about 15%.

## Where the days go

Source: `baseline.json`, `where_the_days_go`.

12.8 of the 17.6 days pass before KYC completes, which is the part a digital journey can remove. The last 4.8 days run from KYC to activation.

Catalogue install times disagree with that gap. The longest install in a bundle averages 7.6 days, or 19.6 for manufacturers. Each target below names its basis.

## Impact model (modelled)

Source: `impact_model.json`. Every assumption is a named constant at the top of `analytics/impact_model.py`.

| | Today | Low | Base | High |
|---|---|---|---|---|
| Lead-to-activation | 7.36% | 9.9% | **15.6%** | 24.9% |
| Activations per 5,000 leads | 368 | 494 | **780** | 1,245 |
| Acquisition cost | ₹15,053 | ₹11,253 | **₹6,194** | ₹3,307 |
| Monthly bundle value | ₹45.4 lakh | ₹56.5 lakh | **₹81.2 lakh** | ₹119.8 lakh |
| Days to activate, all customers | 17.6 | 13.5 | **9.8** | 6.4 |
| Days to activate, digital journey | | 10.2 | **8.0** | 5.5 |

| Main assumption | Low | Base | High |
|---|---|---|---|
| Leads who use the digital journey | 40% | 60% | 75% |
| Field and partner spend saved on those leads | 25% | 50% | 65% |
| Cost to run per adopting lead | ₹100 | ₹50 | ₹25 |
| Cost of an extra activation, as a share of ₹5,385 | 50% | 30% | 20% |

Each of the 20 drop reasons also has its own recovery rate. Price reasons are deliberately low, at 15% and 10% in the base case.

### What the base case rests on

| If we change this | Activation | Acquisition cost |
|---|---|---|
| Base case | 15.6% | ₹6,194 |
| Only 40% of leads adopt | 12.9% | ₹7,884 |
| 75% of leads adopt | 17.7% | ₹5,271 |
| No price-related recovery at all | 14.8% | ₹6,473 |
| No single-product sales | 14.9% | ₹6,410 |
| **Only the reasons the journey removes outright** | **11.5%** | **₹7,886** |
| Field visits to micro stop, and those leads are lost | 16.9% | ₹5,384 |

Two things stand out. The result survives losing all price recovery, which matters because finding 2 says price is hard to move. And 11.5% is a defensible floor, since it counts only drops the journey removes by design.

**Known weakness:** recovered leads are assumed to behave like any other lead in later stages, which may flatter the result. Micro's modelled rise, from 4.1% to 11.7%, is the most uncertain line.

## Candidate targets

These are proposals for you to confirm. They sit slightly inside the base case, so missing the base case by a little still meets them.

| KPI | Baseline | Candidate target | Reasoning |
|---|---|---|---|
| Lead-to-activation | 7.36% | **15%** | Base case 15.6%, floor 11.5% |
| Acquisition cost | ₹15,053 | **₹7,000 or less** | Base case ₹6,194 |
| Time to activate | 17.6 days | **10 days or less overall, shown by segment** | Base case 9.8. Manufacturers stay near 20 because leased lines take 21 to 30 days |
| Status chases | 3.01 | **1 or fewer** | Not modelled. The tracker and proactive updates are built to replace these calls |
| 6-month churn | 15.2% | **12% or less** | Least certain, and not modelled |

**Guardrails, which should be zero:** bundles that break a rule (56 of 368 today), activations on an inactive GSTIN (22 today), and false rejections on the four clean specimens.

## Propensity score

Source: `propensity.json`. Trained on April and May and tested on June, on 1,704 leads.

| Measure | Result |
|---|---|
| Top-decile activation | 15.9%, a lift of 2.1 times the 7.5% base rate |
| Share of activations in the top 30% of leads | 54.3% |
| PR-AUC | 0.152, against a base rate of 0.075 |

The score leaves out language and state. Including them didn't change PR-AUC (0.152 either way), so they aren't worth the fairness concern. It uses only what is known when a lead is created. The strongest associations are having a GSTIN and arriving by referral.
