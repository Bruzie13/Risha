"""
FETCH demand forecasting — Random Forest + Gradient Boosting ensemble.

This is the machine-learning model described in the thesis. It is deliberately
the only implementation: the Node API owns HTTP, the database and caching, and
delegates every model fit to this module, so "Python for the machine learning
models" describes what actually runs.

Both learners come from scikit-learn, which is what Hastie et al. (2020) and the
retail-forecasting literature the study cites actually describe:

    RandomForestRegressor      bagged CART trees over bootstrap samples,
                               decorrelated by sampling sqrt(n_features) at
                               each split. Gives a stable baseline that
                               resists noise.
    GradientBoostingRegressor  trees fitted in sequence on the residuals of
                               the previous stage, each shrunk by a learning
                               rate. Picks up the seasonal structure the
                               forest smooths over.

Their means are averaged.

ONE MODEL FOR THE WHOLE SHOP
The two learners are fitted once on every product's history together, not once
per product. A single product at a small shop sells on a handful of days a
month: fitted alone, a tree has a few dozen rows to learn from, memorises the
odd day something sold, and then over-forecasts. Measured against the shop's
own last fortnight, per-product fits predicted about 70% more than actually
sold. Pooled, the model has tens of thousands of product-days to learn what a
weekend, a pay-day or a quiet month does to sales, and each product's own
recent level — its rolling averages — tells it how much that product sells.

FEATURES (one row per product-day)
    calendar   of the day being forecast: day of week, weekend flag, day of
               month, month, public holiday
    recent     the product's sales on the last day on record, and 7, 14 and 28
               days before that
    level      its 7-day and 28-day averages as of the last day on record
    horizon    how many days ahead the forecast is

The calendar features are how the model sees the patterns the study names:
weekend and holiday spikes, pay-day weeks within a month, and the season. It
is trained on up to twelve months of the shop's own sales, the range the study
specifies (three to twelve months).

EVERY DAY IS FORECAST DIRECTLY FROM WHAT IS KNOWN TODAY
The usual shortcut is to forecast tomorrow, pretend that forecast happened,
and forecast the day after from it. That fails for a shop where most products
sell on few days. The model is trained on whole sales — 0, 1, 2 — but fed its
own forecasts it sees 0.1 every day, which looks like "something sold in the
last week" for ever, so it drifts upward. Measured here it over-forecast by
about 35%. Instead each training row pairs what was known on one day with what
sold some days later, and the model learns to forecast any day ahead straight
from the last real sales. Nothing it predicts is ever fed back in.

PROTOCOL
Reads one JSON object on stdin and writes one JSON object on stdout, so the
caller pays scikit-learn's import cost once for a whole batch of products:

    in   {"days": 30, "jobs": [{"key": "...", "series": [..], "first_date": "2026-02-27",
                               "compare": false}, ...]}
    out  {"results": {"<key>": [{"date_offset": 1, "predicted_quantity": 2.4}, ...] | null},
          "importances": {"<key>": [..one weight per feature..]},
          "features": ["day of week", ...]}

A job with "compare": true also carries, for each day, what the forest alone
("rf") and boosting alone ("gb") would have forecast. That is what lets the system show whether the ensemble
really does better than either learner by itself.

A job returns null when its history is too short to train, and the caller falls
back to the statistical baseline — the same behaviour as before.
"""
import json
import sys
import warnings
from datetime import date, timedelta

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor

warnings.filterwarnings("ignore")

WARMUP = 28          # days of history consumed by the lag/rolling features
MIN_TRAIN_ROWS = 14  # training rows required before a fit is trustworthy

RF_PARAMS = dict(
    n_estimators=60,
    max_depth=8,
    min_samples_leaf=20,   # a leaf must rest on many product-days, not one lucky sale
    max_features="sqrt",   # the decorrelation that makes it a forest
    bootstrap=True,
    random_state=7,        # fixed so a rerun reproduces the same forecast
    n_jobs=1,
)

GB_PARAMS = dict(
    n_estimators=80,
    learning_rate=0.05,
    max_depth=2,           # shallow stages: boosting should refine, not memorise
    min_samples_leaf=60,
    subsample=0.8,         # stochastic boosting
    random_state=11,
)


FEATURE_NAMES = [
    "day of week", "weekend", "day of month", "month", "public holiday",
    "sales on the last day", "sales a week before", "sales two weeks before", "sales four weeks before",
    "average of the last 7 days", "average of the last 28 days", "how far ahead",
]

MAX_GAP = 30   # the furthest ahead a training row looks; the live forecast runs 30 days

# Fixed-date Philippine public holidays (month, day). Movable ones — Holy Week,
# Eid, National Heroes Day — are left out rather than guessed at.
HOLIDAYS = {
    (1, 1), (2, 25), (4, 9), (5, 1), (6, 12), (8, 21), (11, 1), (11, 2), (11, 30),
    (12, 8), (12, 24), (12, 25), (12, 30), (12, 31),
}


def _calendar(day):
    """What kind of day it is."""
    dow = (day.weekday() + 1) % 7          # 0 = Sunday, as the rest of the system counts
    return [
        dow,
        1.0 if dow in (0, 6) else 0.0,
        float(day.day),
        float(day.month),
        1.0 if (day.month, day.day) in HOLIDAYS else 0.0,
    ]


def _state(n, qty):
    """What is known about a product once its first n days are on record."""
    return [
        qty[n - 1],
        qty[n - 7],
        qty[n - 14],
        qty[n - 28],
        float(np.mean(qty[n - 7:n])),
        float(np.mean(qty[n - 28:n])),
    ]


def _features(known, target, qty, first_day):
    """Row for forecasting day index `target` from the first `known` days."""
    return _calendar(first_day + timedelta(days=target)) + _state(known, qty) + [float(target - known + 1)]


def _rows(qty, first_day, salt=0):
    """Training rows for one product.

    Each day after the warm-up is paired with what was known some days earlier.
    The gap cycles through 1..MAX_GAP so every horizon is learnt, and is fixed
    by position rather than drawn at random so a rerun gives the same model.
    """
    X, y, age = [], [], []
    n = len(qty)
    for target in range(WARMUP, n):
        gap = 1 + (target * 7 + salt * 13) % MAX_GAP
        known = target - gap + 1
        if known < WARMUP:
            known, gap = target, 1                 # too early for that gap: use the day before
        X.append(_features(known, target, qty, first_day))
        y.append(qty[target])
        age.append(n - 1 - target)
    return X, y, age


def fit_group(jobs, half_life=0):
    """Fit one forest and one boosting model on every job's history together.

    `jobs` all end on the same calendar day, so "recent" means the same thing
    for each. Returns (rf, gb), or None when there is too little to train on.
    """
    X, y, age = [], [], []
    for i, job in enumerate(jobs):
        rows, target, ages = _rows(job["qty"], job["first_day"], i)
        X.extend(rows)
        y.extend(target)
        age.extend(ages)
    if len(X) < MIN_TRAIN_ROWS:
        return None

    X_arr, y_arr = np.asarray(X, dtype=float), np.asarray(y, dtype=float)

    # Recent days can be made to count for more: each day's weight halves
    # every `half_life` days going back. Off (0) unless the caller asks.
    weights = None
    if half_life and half_life > 0:
        weights = np.power(0.5, np.asarray(age, dtype=float) / float(half_life))

    rf = RandomForestRegressor(**RF_PARAMS).fit(X_arr, y_arr, sample_weight=weights)
    gb = GradientBoostingRegressor(**GB_PARAMS).fit(X_arr, y_arr, sample_weight=weights)
    return rf, gb


def forecast_group(jobs, half_life=0):
    """Forecasts for a group of jobs that share an end date.

    Returns ({key: daily predictions}, forest feature weights or None).
    """
    models = fit_group(jobs, half_life)
    if models is None:
        return {job["key"]: None for job in jobs}, None
    rf, gb = models

    # One row per product per day ahead, all forecast in a single call.
    X, owner = [], []
    for i, job in enumerate(jobs):
        n = len(job["qty"])
        for h in range(job["days"]):
            X.append(_features(n, n + h, job["qty"], job["first_day"]))
            owner.append(i)
    X_arr = np.asarray(X, dtype=float)
    rf_pred = np.maximum(0.0, rf.predict(X_arr))
    gb_pred = np.maximum(0.0, gb.predict(X_arr))

    results = {job["key"]: [] for job in jobs}
    for row, i in enumerate(owner):
        job = jobs[i]
        # The ensemble the thesis specifies: forest and boosting, averaged.
        out = {"date_offset": len(results[job["key"]]) + 1,
               "predicted_quantity": round(float(rf_pred[row] + gb_pred[row]) / 2.0, 3)}
        if job["compare"]:
            out["rf"] = round(float(rf_pred[row]), 3)
            out["gb"] = round(float(gb_pred[row]), 3)
        results[job["key"]].append(out)
    return results, [round(float(w), 4) for w in rf.feature_importances_]


def forecast(series, days, first_day, compare=False, half_life=0):
    """One series on its own: (daily predictions, feature weights), or (None, None)."""
    if len(series) < WARMUP + MIN_TRAIN_ROWS:
        return None, None
    job = {"key": "_", "qty": [float(v) for v in series], "first_day": first_day, "days": days, "compare": compare}
    results, weights = forecast_group([job], half_life)
    return results["_"], weights


def _first_day(job):
    """The calendar day the series starts on."""
    try:
        y, m, d = (int(p) for p in str(job.get("first_date", "")).split("-"))
        return date(y, m, d)
    except Exception:
        # Older callers sent only the weekday; any date falling on it will do.
        return date(2023, 1, 1) + timedelta(days=int(job.get("first_dow", 0)))


def main():
    payload = json.load(sys.stdin)
    default_days = int(payload.get("days", 30))
    half_life = float(payload.get("half_life", 0) or 0)

    results, importances = {}, {}
    groups = {}
    for raw in payload.get("jobs", []):
        key = raw.get("key")
        try:
            series = raw.get("series", [])
            if len(series) < WARMUP + MIN_TRAIN_ROWS:
                results[key] = None
                continue
            first_day = _first_day(raw)
            job = {
                "key": key,
                "qty": [float(v) for v in series],
                "first_day": first_day,
                # A job may set its own horizon: the backtest forecasts only the
                # holdout window, while the live forecast runs the full 30 days.
                "days": int(raw.get("days", default_days)),
                "compare": bool(raw.get("compare")),
            }
            # Products are pooled with the others whose history ends on the
            # same day: the live forecast in one group, each backtest cut-off
            # in its own, so a backtest never sees the days it is graded on.
            end_day = first_day + timedelta(days=len(series) - 1)
            groups.setdefault(end_day, []).append(job)
        except Exception as exc:                       # one bad series must not
            print(f"job {key}: {exc}", file=sys.stderr)  # sink the batch
            results[key] = None

    for jobs in groups.values():
        try:
            group_results, weights = forecast_group(jobs, half_life)
            results.update(group_results)
            if weights is not None:
                for job in jobs:
                    importances[job["key"]] = weights
        except Exception as exc:
            print(f"group of {len(jobs)}: {exc}", file=sys.stderr)
            for job in jobs:
                results[job["key"]] = None

    json.dump({"results": results, "importances": importances, "features": FEATURE_NAMES}, sys.stdout)


if __name__ == "__main__":
    main()
