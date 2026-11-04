"""Baselines: KPIs, funnel, drop reasons, segments, channels and where the days go."""
from common import SOURCE_NOTE, STAGES, acquisition_cost, load_catalogue, load_leads, write_json

# Grouping is ours, from the msme-analytics skill. It says how directly a digital journey helps.
DROP_REASON_GROUPS = {
    "Owner had no time for a visit": "direct",
    "Visit not scheduled by sales": "direct",
    "Quote too complex to understand": "direct",
    "Quote took too long to arrive": "direct",
    "Found paperwork too long": "direct",
    "Missing GST or Udyam document": "direct",
    "Document details did not match": "direct",
    "Unreachable after 3 attempts": "contactability",
    "Wrong or invalid number": "contactability",
    "Price too high": "partly",
    "Competitor offered cheaper plan": "partly",
    "Only wanted a mobile plan": "partly",
    "Not interested on first call": "partly",
    "Decided to wait": "partly",
    "Locked in with current provider": "other",
    "Authorised signatory not available": "other",
    "Installation delayed beyond 21 days": "other",
    "Customer cancelled before install": "other",
    "Site not feasible for fibre": "other",
    "First payment failed": "other",
}


def kpis(leads, activated):
    return {
        "leads": len(leads),
        "activations": len(activated),
        "lead_to_activation_pct": round(len(activated) / len(leads) * 100, 2),
        "acquisition_cost_inr": round(acquisition_cost(leads)),
        "acquisition_cost_trap_inr": round(activated["acquisition_cost_inr"].mean()),
        "total_spend_inr": int(leads["acquisition_cost_inr"].sum()),
        "time_to_activate_days": round(activated["days_lead_to_activation"].mean(), 1),
        "status_chases": round(activated["customer_follow_up_calls"].mean(), 2),
        "churn_6m_pct": round((activated["churned_within_6_months"] == "Y").mean() * 100, 1),
        "median_bundle_inr": float(activated["monthly_bundle_value_inr"].median()),
        "mean_nps": round(activated["nps_score"].mean(), 1),
    }


def funnel(leads):
    counts = [int((leads["stage_rank"] >= i).sum()) for i in range(len(STAGES))]
    return [
        {
            "stage": stage,
            "leads": counts[i],
            "pct_of_previous": round(counts[i] / counts[i - 1] * 100, 1) if i else None,
        }
        for i, stage in enumerate(STAGES)
    ]


def drop_reasons(leads):
    dropped = leads[~leads["activated"]]
    rows = []
    for (stage, reason), group in dropped.groupby(["stage_reached", "drop_reason"]):
        rows.append({"last_stage": stage, "reason": reason, "group": DROP_REASON_GROUPS[reason], "leads": len(group)})
    rows.sort(key=lambda row: (STAGES.index(row["last_stage"]), -row["leads"]))

    by_group = {}
    for row in rows:
        by_group[row["group"]] = by_group.get(row["group"], 0) + row["leads"]

    quote_stage = [row for row in rows if row["last_stage"] == "Needs assessed"]
    total = sum(row["leads"] for row in quote_stage)
    price = sum(row["leads"] for row in quote_stage if row["reason"] in ("Price too high", "Competitor offered cheaper plan"))
    friction = sum(
        row["leads"] for row in quote_stage if row["reason"] in ("Quote too complex to understand", "Quote took too long to arrive")
    )
    return {
        "by_stage_and_reason": rows,
        "by_group": {key: {"leads": value, "pct": round(value / len(dropped) * 100, 1)} for key, value in by_group.items()},
        "steepest_drop": {
            "total": total,
            "price_or_competitor": price,
            "price_or_competitor_pct": round(price / total * 100, 1),
            "slow_or_complex_quote": friction,
            "slow_or_complex_quote_pct": round(friction / total * 100, 1),
        },
    }


def segments(leads, longest_install):
    activated_total = int(leads["activated"].sum())
    value_total = leads.loc[leads["activated"], "monthly_bundle_value_inr"].sum()
    rows = []
    for name, group in leads.groupby("segment"):
        active = group[group["activated"]]
        median_value = float(active["monthly_bundle_value_inr"].median())
        cost = acquisition_cost(group)
        rows.append(
            {
                "segment": name,
                "leads": len(group),
                "lead_share_pct": round(len(group) / len(leads) * 100, 1),
                "activations": len(active),
                "activation_share_pct": round(len(active) / activated_total * 100, 1),
                "activation_pct": round(len(active) / len(group) * 100, 1),
                "acquisition_cost_inr": round(cost),
                "median_bundle_inr": median_value,
                "mean_bundle_inr": round(active["monthly_bundle_value_inr"].mean()),
                "bundle_value_share_pct": round(active["monthly_bundle_value_inr"].sum() / value_total * 100, 1),
                "payback_months_of_revenue": round(cost / median_value, 1),
                "churn_6m_pct": round((active["churned_within_6_months"] == "Y").mean() * 100, 1),
                "has_gstin_pct": round((group["has_gstin"] == "Y").mean() * 100, 1),
                "mean_days_to_activate": round(active["days_lead_to_activation"].mean(), 1),
                "mean_longest_catalogue_install_days": round(longest_install[active.index].mean(), 1),
            }
        )
    return rows


def channels(leads):
    total_spend = leads["acquisition_cost_inr"].sum()
    total_activations = leads["activated"].sum()
    rows = []
    for name, group in leads.groupby("lead_source"):
        stages = [int((group["stage_rank"] >= i).sum()) for i in range(len(STAGES))]
        rows.append(
            {
                "source": name,
                "leads": len(group),
                "activation_pct": round(group["activated"].mean() * 100, 1),
                "acquisition_cost_inr": round(acquisition_cost(group)),
                "spend_share_pct": round(group["acquisition_cost_inr"].sum() / total_spend * 100, 1),
                "activation_share_pct": round(group["activated"].sum() / total_activations * 100, 1),
                "contact_pct": round(stages[1] / stages[0] * 100, 1),
                "quote_acceptance_pct": round(stages[3] / stages[2] * 100, 1),
            }
        )
    rows.sort(key=lambda row: -row["activation_pct"])
    human = [row for row in rows if row["source"] in ("Field sales", "Channel partner")]
    return {
        "by_source": rows,
        "field_and_partner": {
            "spend_share_pct": round(sum(row["spend_share_pct"] for row in human), 1),
            "activation_share_pct": round(sum(row["activation_share_pct"] for row in human), 1),
        },
    }


def segment_by_source(leads):
    """Shows where each channel earns its cost, which is the evidence for the field force's role."""
    rows = []
    for (segment, source), group in leads.groupby(["segment", "lead_source"]):
        active = group[group["activated"]]
        cost = acquisition_cost(group)
        segment_median = leads.loc[(leads["segment"] == segment) & leads["activated"], "monthly_bundle_value_inr"].median()
        rows.append(
            {
                "segment": segment,
                "source": source,
                "leads": len(group),
                "activations": len(active),
                "activation_pct": round(len(active) / len(group) * 100, 1),
                "acquisition_cost_inr": None if not len(active) else round(cost),
                "payback_months_of_segment_median": None if not len(active) else round(cost / segment_median, 1),
                "small_group": len(active) < 10,
            }
        )
    return rows


def where_the_days_go(activated, longest_install):
    gaps = {}
    columns = ["created_date", "contacted_date", "needs_assessed_date", "quote_accepted_date", "kyc_complete_date", "activated_date"]
    for before, after in zip(columns, columns[1:]):
        gaps[f"{before}_to_{after}"] = round((activated[after] - activated[before]).dt.days.mean(), 1)
    pre_kyc = (activated["kyc_complete_date"] - activated["created_date"]).dt.days.mean()
    return {
        "mean_days_between_stages": gaps,
        "mean_days_before_kyc_complete": round(pre_kyc, 1),
        "mean_days_kyc_to_activation": gaps["kyc_complete_date_to_activated_date"],
        "mean_longest_catalogue_install_days": round(longest_install[activated.index].mean(), 1),
        "note": "Catalogue install time and the historic KYC-to-activation gap disagree, so each target must name its basis.",
    }


def caveats(activated):
    today = "2026-07-15"
    return {
        "activations_after_today": int((activated["activated_date"] > today).sum()),
        "activations_within_6_months_of_today": int((activated["activated_date"] >= "2026-01-15").sum()),
        "note": "No activation has had 6 full months by the pack's 'today', so the churn label is used as given and footnoted.",
    }


def main():
    leads = load_leads()
    catalogue = load_catalogue()
    install = catalogue["typical_install_days"].astype(int)
    activated = leads[leads["activated"]]
    longest_install = activated["bundle_products"].map(
        lambda bundle: max(install[item.split("x")[0]] for item in bundle.split(";"))
    )

    path = write_json(
        "baseline.json",
        {
            "source": SOURCE_NOTE,
            "kpis": kpis(leads, activated),
            "funnel": funnel(leads),
            "drop_reasons": drop_reasons(leads),
            "segments": segments(leads, longest_install),
            "channels": channels(leads),
            "segment_by_source": segment_by_source(leads),
            "where_the_days_go": where_the_days_go(activated, longest_install),
            "caveats": caveats(activated),
        },
    )
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
