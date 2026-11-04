"""Signals in the leads data, each checked for confounding and small groups. These are associations, not causes."""
import pandas as pd

from common import SOURCE_NOTE, load_catalogue, load_leads, wilson_interval, write_json

MIN_GROUP_FOR_CLAIM = 30


def rate_table(frame, column, outcome="activated"):
    rows = []
    for value, group in frame.groupby(column, observed=True):
        hits = int(group[outcome].sum())
        rows.append(
            {
                column: value,
                "n": len(group),
                "pct": round(hits / len(group) * 100, 1),
                "ci95": wilson_interval(hits, len(group)),
                "small_group": len(group) < MIN_GROUP_FOR_CLAIM,
            }
        )
    return rows


def standardised_rates(leads, column):
    """Activation per value if each value had the overall segment mix, to strip out segment effects."""
    weights = leads["segment"].value_counts(normalize=True)
    rows = []
    for value, group in leads.groupby(column):
        by_segment = group.groupby("segment")["activated"].mean()
        rate = sum(by_segment.get(segment, 0) * weight for segment, weight in weights.items())
        rows.append(
            {column: value, "n": len(group), "raw_pct": round(group["activated"].mean() * 100, 1), "segment_adjusted_pct": round(rate * 100, 1)}
        )
    return sorted(rows, key=lambda row: -row["segment_adjusted_pct"])


def gstin_by_segment(leads):
    rows = []
    for segment, group in leads.groupby("segment"):
        with_gstin = group[group["has_gstin"] == "Y"]
        without = group[group["has_gstin"] != "Y"]
        rows.append(
            {
                "segment": segment,
                "with_gstin_n": len(with_gstin),
                "with_gstin_pct": round(with_gstin["activated"].mean() * 100, 1),
                "without_gstin_n": len(without),
                "without_gstin_pct": round(without["activated"].mean() * 100, 1) if len(without) else None,
                "small_group": len(without) < MIN_GROUP_FOR_CLAIM,
            }
        )
    return rows


def rule_breaks(leads, catalogue):
    """Counts historic bundles a catalogue rule would have blocked. The TypeScript engine is the authority; this checks it."""
    registry = pd.read_csv(load_registry_path(), dtype=str, keep_default_na=False).set_index("gstin")["status"]
    activated = leads[leads["activated"]]
    broke = []
    for _, lead in activated.iterrows():
        ids = [item.split("x")[0] for item in lead["bundle_products"].split(";")]
        status = registry.get(lead["gstin"], "None") if lead["has_gstin"] == "Y" else "None"
        hit = False
        for product_id in ids:
            row = catalogue.loc[product_id]
            if lead["city_tier"] not in row["available_city_tiers"].split(";"):
                hit = True
            if lead["employee_count"] < int(row["min_employees"]) or lead["num_sites"] < int(row["min_sites"]):
                hit = True
            if row["requires_gstin"] == "Y" and status != "Active":
                hit = True
            needed = row["requires_one_of"]
            if needed and not set(needed.split("|")) & set(ids):
                hit = True
        broke.append(hit)
    flagged = activated[pd.Series(broke, index=activated.index)]
    return {
        "flagged": len(flagged),
        "of": len(activated),
        "flagged_and_churned": int((flagged["churned_within_6_months"] == "Y").sum()),
        "churn_if_flagged_pct": round((flagged["churned_within_6_months"] == "Y").mean() * 100, 1),
        "churn_if_clean_pct": round((activated.drop(flagged.index)["churned_within_6_months"] == "Y").mean() * 100, 1),
        "note": "No claim that breaking a rule causes churn.",
    }


def load_registry_path():
    from common import DATA_DIR

    return DATA_DIR / "mock_gstin_registry.csv"


def main():
    leads = load_leads()
    catalogue = load_catalogue()
    activated = leads[leads["activated"]].copy()
    activated["churned"] = activated["churned_within_6_months"] == "Y"
    activated["days_band"] = pd.cut(
        activated["days_lead_to_activation"], [0, 14, 21, 1000], labels=["14 or under", "15 to 21", "over 21"]
    )

    gstin = leads.groupby("has_gstin")["activated"].mean().mul(100).round(1).to_dict()

    path = write_json(
        "signals.json",
        {
            "source": SOURCE_NOTE,
            "reading_note": "Associations, not causes. Say what would test each one. Treat small_group rows as anecdote.",
            "gstin": {"overall_pct": gstin, "by_segment": gstin_by_segment(leads)},
            "city_tier": rate_table(leads, "city_tier"),
            "language": standardised_rates(leads, "preferred_language"),
            "current_provider": standardised_rates(leads, "current_provider"),
            "current_internet": standardised_rates(leads, "current_internet"),
            "lead_source": standardised_rates(leads, "lead_source"),
            "chase_calls_vs_churn": rate_table(activated, "customer_follow_up_calls", "churned"),
            "chase_calls_vs_nps": activated.groupby("customer_follow_up_calls")["nps_score"].mean().round(1).to_dict(),
            "days_vs_churn": rate_table(activated, "days_band", "churned"),
            "days_vs_nps": activated.groupby("days_band", observed=True)["nps_score"].mean().round(1).to_dict(),
            "rule_breaks": rule_breaks(leads, catalogue),
        },
    )
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
