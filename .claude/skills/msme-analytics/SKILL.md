---
name: msme-analytics
description: Analyse smb_leads.csv and build Udyam Digital analytics, including lead funnel analysis, customer segmentation, lead propensity scoring, conversion analysis, churn analysis and business KPI dashboards. Use for business case numbers, success metrics and targets, segment prioritisation, the back-office view and any chart or KPI in the project.
---

# MSME Analytics

Every number in the business case, dashboard or demo must be reproducible from `YTL_TrackA_Udyam_Digital_Data/smb_leads.csv`. Judges know the signals planted in the data, so correct definitions matter.

## Loading the data

```python
leads = pd.read_csv(path, dtype=str, keep_default_na=False)
```

**Use `keep_default_na=False`.** `current_internet` and `current_provider` hold the literal string `None` in 124 rows, and pandas silently turns it into a missing value. Blanks then mean "stage not reached" or "not applicable". Cast numeric columns explicitly afterwards.

## Definitions

| Metric | Definition | Baseline |
|---|---|---|
| Lead-to-activation | Activated / all leads | 7.36% (368 of 5,000) |
| Acquisition cost | **Σ `acquisition_cost_inr` over all leads** / activated | ₹15,053 |
| Time to activate | Mean `days_lead_to_activation`, activated only | 17.6 days |
| Status chases | Mean `customer_follow_up_calls`, activated only | 3.01 |
| 6-month churn | `churned_within_6_months = Y` / activated | 15.2% (56 of 368) |
| Median bundle | `monthly_bundle_value_inr`, activated only | ₹6,900 per month |

**The acquisition cost trap:** averaging `acquisition_cost_inr` over activated leads gives ₹5,385, which leaves out what was spent on leads that dropped. Always use total spend.

**The date trap:** "today" is 2026-07-15 for date checks, but `activated_date` runs to 2026-07-26. Don't filter out later dates, because the funnel totals depend on them.

## Funnel

| Stage | Leads | % of previous |
|---|---|---|
| Lead | 5,000 | |
| Contacted | 3,406 | 68% |
| Needs assessed | 1,974 | 58% |
| Quote accepted | 861 | 44% |
| KYC complete | 588 | 68% |
| Activated | 368 | 63% |

`stage_reached` is the **last** stage, so count cumulatively. These numbers must tie to the README and case appendix.

## Segments

| Segment | Leads | Activation | Acquisition cost | Median bundle | Churn | Mean days |
|---|---|---|---|---|---|---|
| Micro retail & services | 2,709 | 4.1% | ₹20,007 | ₹2,470 | 22.7% | 16.6 |
| Professional offices | 1,247 | 11.1% | ₹10,695 | ₹6,575 | 13.8% | 16.9 |
| Small multi-site | 755 | 11.0% | ₹15,614 | ₹28,080 | 10.8% | 18.8 |
| Small manufacturers | 289 | 12.8% | ₹15,324 | ₹15,910 | 8.1% | 20.5 |

Acquisition cost as months of median bundle revenue: micro 8.1, professional 1.6, multi-site 0.6, manufacturers 1.0. This is revenue, not margin, because the pack has no cost data. Any margin assumption must be labelled as one.

## Channels

| Source | Leads | Activation | Acquisition cost |
|---|---|---|---|
| Referral | 413 | 14.8% | ₹4,099 |
| Inbound call | 504 | 9.5% | ₹5,113 |
| Channel partner | 1,010 | 8.0% | ₹20,851 |
| Field sales | 1,720 | 7.3% | ₹24,335 |
| Website form | 995 | 4.3% | ₹6,352 |
| WhatsApp campaign | 358 | 2.8% | ₹4,026 |

Field sales and partners take 85% of spend for 56% of activations. Digital channels are cheap but convert worst today, which is the gap this project aims to close.

## Other signals

| Signal | Finding | Care needed |
|---|---|---|
| GSTIN | 9.6% activation with one, 2.0% without | Holds within segments: micro 6.3% against 1.6%, professional 12.1% against 4.6%. Multi-site and manufacturers have too few without one to read |
| GSTIN status | 22 activated on Cancelled or Suspended GSTINs | Today's process doesn't catch these; Smart KYC would |
| Chase calls | 1 call: 5.9% churn, NPS 7.5. 5 calls: 27.9%, NPS 6.0 | Supports the tracker; n = 34 and 43 |
| Slow activation | Over 21 days: NPS 6.0 vs 7.2 at 14 days or under | Churn stays flat at about 15% |
| City tier | Tier 1 8.6%, tier 2 6.1% | Tier affects eligibility too |
| Language | Tamil 4.3%, Punjabi 4.2%, Kannada 5.1% vs Hindi 7.9%, English 8.0% | Holds after adjusting for segment and within city tiers (4.7% vs 8.0%, p = 0.005), but the three were chosen after seeing the data. Not uniform: Bengali 9.0%, Malayalam 8.4%, small samples |
| Current provider | Existing Accel customers about 9.1%, local ISP 5.4% | Cross-sell angle |
| Bundle rule breaks | 56 of 368 break a catalogue rule | Only 5 of these churned; don't claim that breaks cause churn |

These are our own findings, not the judges' list. Associations are not causes, so write "is associated with" and say what would test it. Don't draw conclusions from small groups, such as 8-product bundles (n = 7) or 6-month contracts (n = 3).

## Drop reasons

Group `drop_reason` (4,632 dropped). This grouping is ours:

| Group | Reasons | Count |
|---|---|---|
| Fixed directly by a digital journey | No time for a visit, visit not scheduled, quote too complex, quote too slow, paperwork too long, missing document, details didn't match | 1,432 (31%) |
| Contactability | Unreachable after 3 attempts, wrong or invalid number | 1,124 (24%) |
| Partly addressable | Price too high, competitor cheaper, only wanted a mobile plan, not interested, decided to wait | 1,478 (32%) |
| Other | Locked in, signatory unavailable, installation delayed, cancelled before install, fibre not feasible, payment failed | 598 (13%) |

Be careful with impact claims. A funnel model should say which reasons it assumes are recovered, and at what rate, and show a low, base and high case.

## Propensity score

A stretch goal: rank which leads a human should call.

**Avoid leakage.** Use only what is known when the lead is created.

| Allowed | Not allowed (known only afterwards) |
|---|---|
| `lead_source`, `segment`, `business_type`, `city_tier`, `state`, `preferred_language`, `employee_count`, `num_sites`, `annual_turnover_band`, `has_gstin`, `has_udyam`, `current_internet`, `current_provider`, `monthly_telecom_spend_inr`, count of `products_of_interest`, `contact_role` | `stage_reached`, `outcome`, `drop_reason`, all stage dates, `days_lead_to_activation`, `customer_follow_up_calls`, `bundle_products`, `monthly_bundle_value_inr`, `one_time_setup_inr`, `contract_months`, `churned_within_6_months`, `nps_score`, `acquisition_cost_inr` |

Also leave out `lead_id`, names and identifiers. `acquisition_cost_inr` looks harmless but grows as a lead moves through the funnel.

Approach:

1. Start with regularised logistic regression, because its coefficients explain themselves. Move to gradient boosting only if it clearly beats that.
2. Split by time: train on April and May leads and test on June, as well as a stratified cross-validation check.
3. With a 7.4% base rate, report PR-AUC and lift in the top decile, not accuracy.
4. Export the coefficients as JSON so the app can score leads in TypeScript, without a Python service.
5. Show the owner of the queue the top 3 reasons behind each score, and display bands rather than false-precision decimals.

The back-office view should mix score with reason: leads the advisor couldn't close, sorted by propensity, with why they stalled and the next action.

## Churn

Use only activated customers (n = 368, 56 churned). The sample is small, so report groups and confidence intervals rather than a complex model. Micro churn of 22.7% against 8.1% for manufacturers is the headline.

## KPI framework

The case asks for 3 to 5 metrics with targets:

| KPI | Baseline | Target |
|---|---|---|
| Lead-to-activation | 7.36% | Team to set |
| Time to activate | 17.6 days | Team to set |
| Acquisition cost per activation | ₹15,053 | Team to set |
| Status chases per customer | 3.01 | Team to set |
| 6-month churn | 15.2% | Team to set |

Show the reasoning behind each target. Add guardrail metrics, such as KYC false rejections and rule violations in sold bundles, which should be zero.

Label prototype activity separately from the Apr to Jun baseline, and never present simulated numbers as measured results.

## Dashboards

- Load the `dataviz` skill before writing any chart, and use `airtel-design-system` tokens.
- Put the conclusion in the title: "Micro takes 8 months of revenue to recover acquisition cost".
- Show source and period on every chart: `smb_leads.csv, Apr-Jun 2026 (synthetic)`.
- Mask names and identifiers in any lead table, and aggregate wherever row-level detail isn't needed.

## Reproducibility

- Keep analysis in `analytics/` as scripts with fixed seeds, writing outputs to `analytics/output/`.
- Add a test asserting the funnel, ₹15,053 and the 56 of 368 figure, so a wrong loader fails loudly.
- Cite the script behind every number used in the deck.
