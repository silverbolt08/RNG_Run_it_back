"""
Low, base and high impact cases for the digital journey.

Everything uncertain lives in the constants below, so it can be read and challenged. These are
team assumptions, not measurements: the prototype has no real customers. Results are modelled
and must be labelled that way wherever they appear.

Method: at each funnel stage, each drop reason's share of leads shrinks by its assumed recovery
rate. Recovered leads then face the later stages like anyone else. That gives a rate for leads on
the digital journey, which is blended with today's rate by the share of leads who adopt it. Run
per segment and summed, because segments have different drop reasons and bundle values.
"""
from common import SOURCE_NOTE, STAGES, load_catalogue, load_leads, write_json

CASES = ["low", "base", "high"]

# Share of leads dropping for this reason that the digital journey recovers: (low, base, high).
RECOVERY_RATES = {
    # Advisor replaces the visit, so these two have the strongest case.
    "Owner had no time for a visit": (0.30, 0.50, 0.70),
    "Visit not scheduled by sales": (0.40, 0.60, 0.80),
    # Instant, plain-language quote.
    "Quote too complex to understand": (0.50, 0.70, 0.85),
    "Quote took too long to arrive": (0.60, 0.80, 0.90),
    # Lookup first, ask only for what the bundle needs, and tell the owner what's wrong straight away.
    "Missing GST or Udyam document": (0.30, 0.50, 0.70),
    "Found paperwork too long": (0.50, 0.70, 0.85),
    "Document details did not match": (0.20, 0.40, 0.60),
    # A link the owner can act on later, instead of three missed calls.
    "Unreachable after 3 attempts": (0.10, 0.25, 0.40),
    # OTP stops bad numbers at capture, but an existing bad number can't be reached.
    "Wrong or invalid number": (0.00, 0.10, 0.20),
    # Price is deliberately low: a clearer journey doesn't make the bundle cheaper. See finding 1.
    "Price too high": (0.05, 0.15, 0.25),
    "Competitor offered cheaper plan": (0.00, 0.10, 0.20),
    # The advisor can sell one product instead of forcing a bundle, at much lower value.
    "Only wanted a mobile plan": (0.30, 0.50, 0.70),
    "Not interested on first call": (0.00, 0.05, 0.10),
    # A saved quote and a reminder, with consent.
    "Decided to wait": (0.05, 0.15, 0.25),
    "Locked in with current provider": (0.00, 0.05, 0.10),
    # A shareable link helps, but the signatory still has to act.
    "Authorised signatory not available": (0.10, 0.25, 0.40),
    # Digital doesn't shorten an install, but it can offer AirFiber and keep the owner informed.
    "Installation delayed beyond 21 days": (0.00, 0.15, 0.30),
    "Customer cancelled before install": (0.10, 0.25, 0.40),
    # Asking about fibre early, with AirFiber as the fallback.
    "Site not feasible for fibre": (0.30, 0.50, 0.70),
    "First payment failed": (0.30, 0.50, 0.70),
}

PRICE_REASONS = ("Price too high", "Competitor offered cheaper plan")
MOBILE_ONLY_REASON = "Only wanted a mobile plan"

DIRECT_REASONS = (
    "Owner had no time for a visit",
    "Visit not scheduled by sales",
    "Quote too complex to understand",
    "Quote took too long to arrive",
    "Missing GST or Udyam document",
    "Found paperwork too long",
    "Document details did not match",
)

# Share of leads who actually use the digital journey. The rest behave as they do today.
# This is the largest single assumption, so the sensitivity section shows the result without it.
DIGITAL_ADOPTION = {"low": 0.40, "base": 0.60, "high": 0.75}

# Share of field and partner spend saved on leads that use the digital journey, because
# people only handle what the advisor can't close. Partners keep credit through attribution.
HUMAN_SPEND_SAVING_ON_ADOPTED = {"low": 0.25, "base": 0.50, "high": 0.65}

# Rupees per adopting lead to run the advisor, messaging and lookups. A placeholder until we have real usage.
DIGITAL_COST_PER_LEAD_INR = {"low": 100, "base": 50, "high": 25}

# An extra activation isn't free: it still draws assisted closes and commissions. Each costs this
# share of what an activated lead carries historically (Rs 5,385 on average).
EXTRA_ACTIVATION_COST_SHARE = {"low": 0.50, "base": 0.30, "high": 0.20}

# Days before KYC completes on the digital journey, against 12.8 historically.
DIGITAL_DAYS_BEFORE_KYC = {"low": 3, "base": 1, "high": 1}

# A mobile-only sale isn't worth a bundle. Valued at 2 lines (historic median) of Business Postpaid 299.
MOBILE_ONLY_LINES = 2

HUMAN_SOURCES = ("Field sales", "Channel partner")


def recovery(reason, case, rates):
    return rates[reason][CASES.index(case)]


def activations_for(group, case, rates):
    """Runs one group of leads through the funnel with drop reasons reduced."""
    remaining = float(len(group))
    for rank, _stage in enumerate(STAGES[:-1]):
        at_stage = (group["stage_rank"] >= rank).sum()
        if at_stage == 0:
            return 0.0
        drops = group[group["stage_rank"] == rank]["drop_reason"].value_counts()
        kept_drop_share = sum(count / at_stage * (1 - recovery(reason, case, rates)) for reason, count in drops.items())
        remaining *= 1 - kept_drop_share
    return remaining


def without(reasons):
    return {reason: ((0, 0, 0) if reason in reasons else value) for reason, value in RECOVERY_RATES.items()}


def only(reasons):
    return {reason: (value if reason in reasons else (0, 0, 0)) for reason, value in RECOVERY_RATES.items()}


def run_case(leads, case, mobile_line_inr, adoption=None, rates=RECOVERY_RATES):
    adopted = DIGITAL_ADOPTION[case] if adoption is None else adoption
    rows = []
    for segment, group in leads.groupby("segment"):
        active = group[group["activated"]]
        baseline = len(active)
        mean_value = active["monthly_bundle_value_inr"].mean()
        median_value = active["monthly_bundle_value_inr"].median()

        digital = activations_for(group, case, rates)
        digital_bundles = activations_for(group, case, {**rates, MOBILE_ONLY_REASON: (0, 0, 0)})
        total = adopted * digital + (1 - adopted) * baseline
        mobile_only = adopted * (digital - digital_bundles)
        bundles = total - mobile_only

        human = group[group["lead_source"].isin(HUMAN_SOURCES)]["acquisition_cost_inr"].sum()
        other = group[~group["lead_source"].isin(HUMAN_SOURCES)]["acquisition_cost_inr"].sum()
        extra_cost = max(total - baseline, 0) * EXTRA_ACTIVATION_COST_SHARE[case] * active["acquisition_cost_inr"].mean()
        spend = (
            other
            + human * (1 - adopted * HUMAN_SPEND_SAVING_ON_ADOPTED[case])
            + len(group) * adopted * DIGITAL_COST_PER_LEAD_INR[case]
            + extra_cost
        )
        cost = spend / total

        install_catalogue = float(segment_install(active))
        install_historic = (active["activated_date"] - active["kyc_complete_date"]).dt.days.mean()
        digital_days = DIGITAL_DAYS_BEFORE_KYC[case] + (install_historic if case == "high" else install_catalogue)
        today_days = active["days_lead_to_activation"].mean()
        blended_days = (adopted * digital * digital_days + (1 - adopted) * baseline * today_days) / total

        rows.append(
            {
                "segment": segment,
                "leads": len(group),
                "activations_baseline": baseline,
                "activations": round(total),
                "of_which_mobile_only": round(mobile_only),
                "activation_pct": round(total / len(group) * 100, 1),
                "digital_journey_activation_pct": round(digital / len(group) * 100, 1),
                "spend_inr": round(spend),
                "acquisition_cost_inr": round(cost),
                "payback_months_of_median": round(cost / median_value, 1),
                "monthly_value_inr": round(bundles * mean_value + mobile_only * mobile_line_inr * MOBILE_ONLY_LINES),
                "days_to_activate_blended": round(blended_days, 1),
                "days_to_activate_digital": round(digital_days, 1),
                "_activations_exact": total,
                "_digital_exact": adopted * digital,
                "_digital_days": digital_days,
            }
        )
    return rows


def segment_install(active):
    catalogue = load_catalogue()
    install = catalogue["typical_install_days"].astype(int)
    return active["bundle_products"].map(lambda b: max(install[item.split("x")[0]] for item in b.split(";"))).mean()


def summarise(rows, leads):
    activations = sum(row["_activations_exact"] for row in rows)
    digital = sum(row["_digital_exact"] for row in rows)
    spend = sum(row["spend_inr"] for row in rows)
    return {
        "activations": round(activations),
        "lead_to_activation_pct": round(activations / len(leads) * 100, 1),
        "acquisition_cost_inr": round(spend / activations),
        "monthly_value_inr": sum(row["monthly_value_inr"] for row in rows),
        "days_to_activate_blended": round(
            sum(row["days_to_activate_blended"] * row["_activations_exact"] for row in rows) / activations, 1
        ),
        "days_to_activate_digital": round(sum(row["_digital_days"] * row["_digital_exact"] for row in rows) / digital, 1),
    }


def sensitivity(leads, mobile_line_inr):
    """How much of the base case rests on each assumption, so the weakest ones are visible."""

    def outcome(frame=leads, adoption=None, rates=RECOVERY_RATES):
        total = summarise(run_case(frame, "base", mobile_line_inr, adoption, rates), frame)
        return {
            "activations": total["activations"],
            "lead_to_activation_pct": total["lead_to_activation_pct"],
            "acquisition_cost_inr": total["acquisition_cost_inr"],
        }

    micro_field = (leads["segment"] == "Micro retail & services") & (leads["lead_source"] == "Field sales")
    return {
        "base_case": outcome(),
        "adoption_40pct": outcome(adoption=0.40),
        "adoption_75pct": outcome(adoption=0.75),
        "adoption_100pct_digital_journey_alone": outcome(adoption=1.0),
        "no_price_recovery": outcome(rates=without(PRICE_REASONS)),
        "no_mobile_only_sales": outcome(rates=without((MOBILE_ONLY_REASON,))),
        "only_reasons_the_journey_removes_outright": outcome(rates=only(DIRECT_REASONS)),
        "stop_field_visits_to_micro": outcome(frame=leads[~micro_field]),
        "note": "stop_field_visits_to_micro drops those leads entirely, so it assumes none of them would come another way.",
    }


def field_visits_to_micro(leads):
    micro_field = leads[(leads["segment"] == "Micro retail & services") & (leads["lead_source"] == "Field sales")]
    return {
        "leads": len(micro_field),
        "activations": int(micro_field["activated"].sum()),
        "share_of_all_activations_pct": round(micro_field["activated"].sum() / leads["activated"].sum() * 100, 1),
        "spend_inr": int(micro_field["acquisition_cost_inr"].sum()),
        "share_of_all_spend_pct": round(micro_field["acquisition_cost_inr"].sum() / leads["acquisition_cost_inr"].sum() * 100, 1),
    }


def main():
    leads = load_leads()
    catalogue = load_catalogue()
    p07 = catalogue.loc["P07"]
    mobile_line_inr = round((int(p07["price_min_inr_per_month"]) + int(p07["price_max_inr_per_month"])) / 2)

    baseline_value = int(leads.loc[leads["activated"], "monthly_bundle_value_inr"].sum())
    results = {}
    for case in CASES:
        rows = run_case(leads, case, mobile_line_inr)
        results[case] = {
            "total": summarise(rows, leads),
            "by_segment": [{k: v for k, v in row.items() if not k.startswith("_")} for row in rows],
        }

    path = write_json(
        "impact_model.json",
        {
            "source": SOURCE_NOTE,
            "status": "MODELLED. Assumptions, not measurements. Label as modelled wherever shown.",
            "baseline": {
                "activations": int(leads["activated"].sum()),
                "lead_to_activation_pct": 7.36,
                "acquisition_cost_inr": 15053,
                "monthly_value_inr": baseline_value,
                "days_to_activate": 17.6,
            },
            "assumptions": {
                "recovery_rates_low_base_high": RECOVERY_RATES,
                "digital_adoption": DIGITAL_ADOPTION,
                "human_spend_saving_on_adopted": HUMAN_SPEND_SAVING_ON_ADOPTED,
                "digital_cost_per_lead_inr": DIGITAL_COST_PER_LEAD_INR,
                "extra_activation_cost_share": EXTRA_ACTIVATION_COST_SHARE,
                "digital_days_before_kyc": DIGITAL_DAYS_BEFORE_KYC,
                "days_after_kyc_basis": "Catalogue install time for low and base, historic KYC-to-activation gap for high.",
                "recovered_lead_quality": "Recovered leads are assumed to face later stages like anyone else, which may flatter the result.",
            },
            "cases": results,
            "sensitivity": sensitivity(leads, mobile_line_inr),
            "field_visits_to_micro": field_visits_to_micro(leads),
        },
    )
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
