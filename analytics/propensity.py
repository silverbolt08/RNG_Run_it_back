"""
A simple propensity score: which leads should a person call first?

Uses only what is known when a lead is created, to avoid leakage. Trains on April and May and
tests on June. Coefficients are exported as JSON, so the app can score leads in TypeScript with
no Python service. Language and state are compared with and without, because a score that
quietly favours some languages would be hard to defend.
"""
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from common import SOURCE_NOTE, load_leads, write_json

SEED = 42
TRAIN_BEFORE = "2026-06-01"

CATEGORICAL = [
    "lead_source",
    "segment",
    "city_tier",
    "annual_turnover_band",
    "has_gstin",
    "has_udyam",
    "current_internet",
    "current_provider",
    "contact_role",
]
SENSITIVE = ["preferred_language", "state"]
NUMERIC = ["employee_count", "num_sites", "monthly_telecom_spend_inr", "interest_count"]


def features(leads):
    frame = leads.copy()
    frame["interest_count"] = frame["products_of_interest"].map(lambda value: len(value.split(";")) if value else 0)
    return frame


def build_model(categorical):
    prepare = ColumnTransformer(
        [
            ("categorical", OneHotEncoder(handle_unknown="ignore", drop="first", sparse_output=False), categorical),
            ("numeric", StandardScaler(), NUMERIC),
        ]
    )
    # Regularised so that small groups can't produce large, confident coefficients.
    return Pipeline([("prepare", prepare), ("model", LogisticRegression(C=0.5, max_iter=2000, random_state=SEED))])


def evaluate(train, test, categorical):
    columns = categorical + NUMERIC
    model = build_model(categorical).fit(train[columns], train["activated"])
    scores = model.predict_proba(test[columns])[:, 1]
    labels = test["activated"].to_numpy()

    order = np.argsort(-scores)
    top_decile = order[: max(1, len(order) // 10)]
    top_rate = labels[top_decile].mean()
    base_rate = labels.mean()
    top_three_deciles = order[: max(1, len(order) * 3 // 10)]

    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    everyone = pd.concat([train, test])
    cross_validated = cross_val_score(
        build_model(categorical), everyone[columns], everyone["activated"], cv=folds, scoring="average_precision"
    )

    return model, {
        "test_leads": len(test),
        "test_activations": int(labels.sum()),
        "base_rate_pct": round(base_rate * 100, 1),
        "pr_auc": round(average_precision_score(labels, scores), 3),
        "roc_auc": round(roc_auc_score(labels, scores), 3),
        "top_decile_activation_pct": round(top_rate * 100, 1),
        "top_decile_lift": round(top_rate / base_rate, 2),
        "share_of_activations_in_top_30pct": round(labels[top_three_deciles].sum() / labels.sum() * 100, 1),
        "cross_validated_pr_auc": round(cross_validated.mean(), 3),
    }


def coefficients(model):
    prepare = model.named_steps["prepare"]
    names = [name.split("__", 1)[1] for name in prepare.get_feature_names_out()]
    fitted = model.named_steps["model"]
    numeric = prepare.named_transformers_["numeric"]
    return {
        "intercept": round(float(fitted.intercept_[0]), 4),
        "weights": {name: round(float(weight), 4) for name, weight in zip(names, fitted.coef_[0])},
        "numeric_scaling": {
            name: {"mean": round(float(mean), 4), "scale": round(float(scale), 4)}
            for name, mean, scale in zip(NUMERIC, numeric.mean_, numeric.scale_)
        },
    }


def main():
    leads = features(load_leads())
    train = leads[leads["created_date"] < TRAIN_BEFORE]
    test = leads[leads["created_date"] >= TRAIN_BEFORE]

    model, without_sensitive = evaluate(train, test, CATEGORICAL)
    _, with_sensitive = evaluate(train, test, CATEGORICAL + SENSITIVE)
    exported = coefficients(model)

    ranked = sorted(exported["weights"].items(), key=lambda item: -abs(item[1]))
    path = write_json(
        "propensity.json",
        {
            "source": SOURCE_NOTE,
            "split": {"train": f"created before {TRAIN_BEFORE}", "test": f"created from {TRAIN_BEFORE}", "train_leads": len(train)},
            "excluded_as_leakage": "stage, outcome, drop reason, all later dates, follow-up calls, bundle, value, churn, NPS, acquisition cost",
            "excluded_as_identifying": "lead ID, business name, contact name, GSTIN, Udyam number, city",
            "excluded_as_sensitive": SENSITIVE,
            "metrics_without_language_and_state": without_sensitive,
            "metrics_with_language_and_state": with_sensitive,
            "strongest_associations": dict(ranked[:12]),
            "model": exported,
        },
    )
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
