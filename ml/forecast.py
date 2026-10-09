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
    calendar   day of week, weekend flag, day of month, month, public holiday
    recent     lag-1, lag-7, lag-14, lag-28
    level      7-day rolling mean, 28-day rolling mean, linear time index

The calendar features are how the model sees the patterns the study names:
weekend and holiday spikes, pay-day weeks within a month, and the season. It
is trained on up to twelve months of the shop's own sales, the range the study
specifies (three to twelve months).

Multi-step forecasts are recursive: each predicted day is appended to the
history so the following day's lag features see it.

PROTOCOL
Reads one JSON object on stdin and writes one JSON object on stdout, so the
caller pays scikit-learn's import cost once for a whole batch of products:

    in   {"days": 30, "jobs": [{"key": "...", "series": [..], "first_date": "2026-02-27",
                               "compare": false}, ...]}
    out  {"results": {"<key>": [{"date_offset": 1, "predicted_quantity": 2.4}, ...] | null},
          "importances": {"<key>": [..one weight per feature..]},
          "features": ["day of week", ...]}

A job with "compare": true also carries, for each day, what the forest alone
("rf") and boosting alone ("gb") would have forecast, each run recursively on
its own predictions. That is what lets the system show whether the ensemble
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


FEATURE_NAMES = [
    "day of week", "weekend", "day of month", "month", "public holiday",
    "sales yesterday", "sales a week ago", "sales two weeks ago", "sales four weeks ago",
    "average of the last 7 days", "average of the last 28 days", "long-term trend",
]

# Fixed-date Philippine public holidays (month, day). Movable ones — Holy Week,
# Eid, National Heroes Day — are left out rather than guessed at.
HOLIDAYS = {
    (1, 1), (2, 25), (4, 9), (5, 1), (6, 12), (8, 21), (11, 1), (11, 2), (11, 30),
    (12, 8), (12, 24), (12, 25), (12, 30), (12, 31),
}


def _features(t, qty, first_day):
    """Feature row for day index t, read only from days before t."""
    day = first_day + timedelta(days=t)
    dow = (day.weekday() + 1) % 7          # 0 = Sunday, as the rest of the system counts
    return [
        dow,
        1.0 if dow in (0, 6) else 0.0,
        float(day.day),
        float(day.month),
        1.0 if (day.month, day.day) in HOLIDAYS else 0.0,
        qty[t - 1],
        qty[t - 7],
        qty[t - 14],
        qty[t - 28],
        float(np.mean(qty[t - 7:t])),
        float(np.mean(qty[t - 28:t])),
        float(t),
    ]


def _roll(model_predict, qty, days, first_day):
    """Recursive forecast: each predicted day becomes history for the next."""
    extended = list(qty)
    out = []
    for _ in range(days):
        x = np.asarray([_features(len(extended), extended, first_day)], dtype=float)
        value = max(0.0, float(model_predict(x)))
        extended.append(value)
        out.append(value)
    return out


def forecast(series, days, first_day, compare=False):
    """(daily predictions, forest feature weights), or (None, None) when history is too short."""
    if len(series) < WARMUP + MIN_TRAIN_ROWS:
        return None, None

    qty = [float(v) for v in series]

    X, y = [], []
    for t in range(WARMUP, len(qty)):
        X.append(_features(t, qty, first_day))
        y.append(qty[t])
    if len(X) < MIN_TRAIN_ROWS:
        return None, None

    X_arr, y_arr = np.asarray(X, dtype=float), np.asarray(y, dtype=float)

    rf = RandomForestRegressor(**RF_PARAMS).fit(X_arr, y_arr)
    gb = GradientBoostingRegressor(**GB_PARAMS).fit(X_arr, y_arr)

    # The ensemble the thesis specifies: forest and boosting, averaged.
    both = _roll(lambda x: (rf.predict(x)[0] + gb.predict(x)[0]) / 2.0, qty, days, first_day)
    out = [{"date_offset": i + 1, "predicted_quantity": round(v, 2)} for i, v in enumerate(both)]
    if compare:
        rf_only = _roll(lambda x: rf.predict(x)[0], qty, days, first_day)
        gb_only = _roll(lambda x: gb.predict(x)[0], qty, days, first_day)
        for row, a, b in zip(out, rf_only, gb_only):
            row["rf"] = round(a, 2)
            row["gb"] = round(b, 2)
    return out, [round(float(w), 4) for w in rf.feature_importances_]


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
    days = int(payload.get("days", 30))
    results, importances = {}, {}
    for job in payload.get("jobs", []):
        try:
            # A job may set its own horizon: the backtest forecasts only the
            # holdout window, while the live forecast runs the full 30 days.
            preds, weights = forecast(
                job.get("series", []), int(job.get("days", days)), _first_day(job), bool(job.get("compare"))
            )
            results[job["key"]] = preds
            if weights is not None:
                importances[job["key"]] = weights
        except Exception as exc:                       # one bad series must not
            print(f"job {job.get('key')}: {exc}", file=sys.stderr)  # sink the batch
            results[job["key"]] = None
    json.dump({"results": results, "importances": importances, "features": FEATURE_NAMES}, sys.stdout)


if __name__ == "__main__":
    main()
