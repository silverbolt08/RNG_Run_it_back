"""Shared loading and tie-out checks. Every analysis script starts here, so a wrong loader fails loudly."""
import json
import os
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "YTL_TrackA_Udyam_Digital_Data"))
OUTPUT_DIR = Path(__file__).resolve().parent / "output"

STAGES = ["Lead", "Contacted", "Needs assessed", "Quote accepted", "KYC complete", "Activated"]
SOURCE_NOTE = "smb_leads.csv, Apr-Jun 2026 (synthetic)"

NUMERIC_COLUMNS = [
    "employee_count",
    "num_sites",
    "monthly_telecom_spend_inr",
    "customer_follow_up_calls",
    "days_lead_to_activation",
    "monthly_bundle_value_inr",
    "one_time_setup_inr",
    "contract_months",
    "nps_score",
    "acquisition_cost_inr",
]
DATE_COLUMNS = [
    "created_date",
    "contacted_date",
    "needs_assessed_date",
    "quote_accepted_date",
    "kyc_complete_date",
    "activated_date",
]


def load_leads() -> pd.DataFrame:
    # keep_default_na=False matters: the literal string "None" is a real value in two columns.
    leads = pd.read_csv(DATA_DIR / "smb_leads.csv", dtype=str, keep_default_na=False)
    for column in NUMERIC_COLUMNS:
        leads[column] = pd.to_numeric(leads[column], errors="coerce")
    for column in DATE_COLUMNS:
        leads[column] = pd.to_datetime(leads[column], errors="coerce")
    leads["stage_rank"] = leads["stage_reached"].map({stage: i for i, stage in enumerate(STAGES)})
    leads["activated"] = leads["outcome"] == "Activated"
    assert_ties_out(leads)
    return leads


def load_catalogue() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "product_catalogue.csv", dtype=str, keep_default_na=False).set_index("product_id")


def assert_ties_out(leads: pd.DataFrame) -> None:
    """Stops the run if the data doesn't reproduce the case's published numbers."""
    activated = leads[leads["activated"]]
    funnel = [int((leads["stage_rank"] >= i).sum()) for i in range(len(STAGES))]
    assert funnel == [5000, 3406, 1974, 861, 588, 368], f"Funnel does not tie out: {funnel}"
    assert round(leads["acquisition_cost_inr"].sum() / len(activated)) == 15053, "Acquisition cost does not tie out"
    assert (leads["current_internet"] == "None").sum() == 124, "The literal None was lost on load"


def acquisition_cost(group: pd.DataFrame) -> float:
    """Total spend over all leads in the group, divided by its activations."""
    activations = int(group["activated"].sum())
    return float(group["acquisition_cost_inr"].sum() / activations) if activations else float("nan")


def wilson_interval(successes: int, total: int, z: float = 1.96) -> list[float]:
    """A 95% interval that behaves sensibly on small groups, returned as percentages."""
    if total == 0:
        return [0.0, 0.0]
    p = successes / total
    denominator = 1 + z**2 / total
    centre = (p + z**2 / (2 * total)) / denominator
    margin = z * ((p * (1 - p) / total + z**2 / (4 * total**2)) ** 0.5) / denominator
    return [round((centre - margin) * 100, 1), round((centre + margin) * 100, 1)]


def write_json(name: str, data: dict) -> Path:
    OUTPUT_DIR.mkdir(exist_ok=True)
    path = OUTPUT_DIR / name
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path
