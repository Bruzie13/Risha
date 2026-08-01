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

Their means are averaged. Hyperparameters match the ones the system was
validated with.

FEATURES (one row per day, after a 28-day warm-up):
    day of week, weekend flag, lag-1, lag-7, lag-14,
    7-day rolling mean, 28-day rolling mean, linear time index

Multi-step forecasts are recursive: each predicted day is appended to the
history so the following day's lag features see it.

PROTOCOL
Reads one JSON object on stdin and writes one JSON object on stdout, so the
caller pays scikit-learn's import cost once for a whole batch of products:

    in   {"days": 30, "jobs": [{"key": "...", "series": [..], "first_dow": 0}, ...]}
    out  {"results": {"<key>": [{"date_offset": 1, "predicted_quantity": 2.4}, ...] | null}}

A job returns null when its history is too short to train, and the caller falls
back to the statistical baseline — the same behaviour as before.
"""
import json
import sys
import warnings

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor

warnings.filterwarnings("ignore")

WARMUP = 28          # days of history consumed by the lag/rolling features
MIN_TRAIN_ROWS = 14  # training rows required before a fit is trustworthy

RF_PARAMS = dict(
    n_estimators=40,
    max_depth=6,
    min_samples_leaf=3,
    max_features="sqrt",   # the decorrelation that makes it a forest
    bootstrap=True,
    random_state=7,        # fixed so a rerun reproduces the same forecast
    n_jobs=1,
)

GB_PARAMS = dict(
    n_estimators=60,
    learning_rate=0.08,
    max_depth=3,
    min_samples_leaf=4,
    subsample=0.8,         # stochastic boosting
    random_state=11,
)


def _features(t, qty, first_dow):
    """Feature row for day index t, read only from days before t."""
    dow = (first_dow + t) % 7
    return [
        dow,
        1.0 if dow in (0, 6) else 0.0,
        qty[t - 1],
        qty[t - 7],
        qty[t - 14],
        float(np.mean(qty[t - 7:t])),
        float(np.mean(qty[t - 28:t])),
        float(t),
    ]


def forecast(series, days, first_dow):
    """Daily predictions for `days` ahead, or None when history is too short."""
    if len(series) < WARMUP + MIN_TRAIN_ROWS:
        return None

    qty = [float(v) for v in series]

    X, y = [], []
    for t in range(WARMUP, len(qty)):
        X.append(_features(t, qty, first_dow))
        y.append(qty[t])
    if len(X) < MIN_TRAIN_ROWS:
        return None

    X_arr, y_arr = np.asarray(X, dtype=float), np.asarray(y, dtype=float)

    rf = RandomForestRegressor(**RF_PARAMS).fit(X_arr, y_arr)
    gb = GradientBoostingRegressor(**GB_PARAMS).fit(X_arr, y_arr)

    extended = list(qty)
    out = []
    for step in range(1, days + 1):
        x = np.asarray([_features(len(extended), extended, first_dow)], dtype=float)
        # The ensemble the thesis specifies: forest and boosting, averaged.
        value = max(0.0, float(rf.predict(x)[0] + gb.predict(x)[0]) / 2.0)
        extended.append(value)
        out.append({"date_offset": step, "predicted_quantity": round(value, 2)})
    return out


def main():
    payload = json.load(sys.stdin)
    days = int(payload.get("days", 30))
    results = {}
    for job in payload.get("jobs", []):
        try:
            # A job may set its own horizon: the backtest forecasts only the
            # holdout window, while the live forecast runs the full 30 days.
            results[job["key"]] = forecast(
                job.get("series", []), int(job.get("days", days)), int(job.get("first_dow", 0))
            )
        except Exception as exc:                       # one bad series must not
            print(f"job {job.get('key')}: {exc}", file=sys.stderr)  # sink the batch
            results[job["key"]] = None
    json.dump({"results": results}, sys.stdout)


if __name__ == "__main__":
    main()
