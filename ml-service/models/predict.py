import numpy as np
import pandas as pd


def create_future_features(days=30, last_date=None):
    if last_date is None:
        last_date = pd.Timestamp.now()

    future_dates = pd.date_range(start=last_date + pd.Timedelta(days=1), periods=days, freq="D")
    future_df = pd.DataFrame({"sale_date": future_dates})
    future_df["day_of_week"] = future_df["sale_date"].dt.dayofweek
    future_df["day_of_month"] = future_df["sale_date"].dt.day
    future_df["month"] = future_df["sale_date"].dt.month
    future_df["year"] = future_df["sale_date"].dt.year
    future_df["day_of_year"] = future_df["sale_date"].dt.dayofyear
    future_df["is_weekend"] = (future_df["day_of_week"] >= 5).astype(int)

    holiday_months = [11, 12, 1]
    future_df["is_holiday_season"] = future_df["month"].isin(holiday_months).astype(int)

    return future_df, future_dates


def predict_demand(model_dict, historical_df=None, days=30):
    rf_model = model_dict["rf_model"]
    gb_model = model_dict["gb_model"]
    feature_cols = model_dict["metadata"].get("feature_cols")

    if feature_cols is None and historical_df is not None:
        feature_cols = [
            col for col in historical_df.columns
            if col not in ["product_id", "sale_date", "total_quantity", "total_revenue"]
        ]

    if feature_cols is None:
        raise ValueError("No feature columns available for prediction. Model metadata missing feature_cols and no historical_df provided.")

    future_df, future_dates = create_future_features(days)

    for col in feature_cols:
        if col not in future_df.columns:
            future_df[col] = 0

    if historical_df is not None and not historical_df.empty:
        last_quantities = historical_df["total_quantity"].values
        last_revenues = historical_df.get("total_revenue", pd.Series([0] * len(historical_df))).values
    else:
        last_quantities = np.array([0] * 14)
        last_revenues = np.array([0] * 14)
        historical_df = pd.DataFrame()

    predictions = []
    for i in range(days):
        row = future_df.iloc[[i]].copy()

        if "lag_1" in feature_cols:
            row["lag_1"] = last_quantities[-1] if len(last_quantities) > 0 else 0
        if "lag_7" in feature_cols:
            row["lag_7"] = last_quantities[-7] if len(last_quantities) >= 7 else 0
        if "lag_14" in feature_cols:
            row["lag_14"] = last_quantities[-14] if len(last_quantities) >= 14 else 0
        if "rolling_mean_7" in feature_cols:
            window = last_quantities[-7:] if len(last_quantities) >= 7 else last_quantities
            row["rolling_mean_7"] = np.mean(window)
        if "rolling_mean_14" in feature_cols:
            window = last_quantities[-14:] if len(last_quantities) >= 14 else last_quantities
            row["rolling_mean_14"] = np.mean(window)

        row = row[feature_cols]

        rf_pred = rf_model.predict(row)[0]
        gb_pred = gb_model.predict(row)[0]
        ensemble_pred = (rf_pred + gb_pred) / 2

        clamped_pred = max(0, ensemble_pred)
        predictions.append(clamped_pred)
        last_quantities = np.append(last_quantities, clamped_pred)
        last_revenues = np.append(last_revenues, 0)

    return predictions, future_dates


def calculate_reorder_recommendation(predictions, current_stock=0, reorder_level=0, lead_time_days=7):
    next_month_total = sum(predictions[:30])
    daily_avg = next_month_total / 30 if len(predictions) >= 30 else sum(predictions) / max(len(predictions), 1)
    lead_time_demand = daily_avg * lead_time_days

    if daily_avg > 0:
        days_until_stockout = int(current_stock / daily_avg) if current_stock > 0 else 0
    else:
        days_until_stockout = 999

    recommended_reorder_point = int(lead_time_demand * 1.5)
    reorder_triggered = current_stock <= recommended_reorder_point

    if reorder_triggered:
        suggested_order_quantity = int(next_month_total - current_stock + lead_time_demand)
        suggested_order_quantity = max(suggested_order_quantity, int(lead_time_demand))
    else:
        suggested_order_quantity = 0

    return {
        "current_stock_level": int(current_stock),
        "reorder_level": int(reorder_level),
        "lead_time_days": lead_time_days,
        "average_daily_demand": round(daily_avg, 2),
        "lead_time_demand": round(lead_time_demand, 2),
        "recommended_reorder_point": recommended_reorder_point,
        "days_until_stockout": days_until_stockout,
        "reorder_triggered": reorder_triggered,
        "suggested_order_quantity": suggested_order_quantity,
    }


def get_confidence_score(y_true, y_pred):
    if len(y_true) == 0 or len(y_pred) == 0:
        return {"mape": None, "mae": None, "r2_score": None, "confidence_score": 0}

    y_true = np.array(y_true)
    y_pred = np.array(y_pred)

    mape = np.mean(np.abs((y_true - y_pred) / (y_true + 1e-10))) * 100
    mae = np.mean(np.abs(y_true - y_pred))

    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    r2 = 1 - (ss_res / (ss_tot + 1e-10))

    mape_score = max(0, 100 - mape) / 100
    r2_score_val = max(0, r2)
    confidence_score = round((mape_score * 0.4 + r2_score_val * 0.6) * 100, 2)

    return {
        "mape": round(mape, 2),
        "mae": round(mae, 2),
        "r2_score": round(r2, 4),
        "confidence_score": confidence_score,
    }


def detect_trend(predictions):
    if len(predictions) < 2:
        return "stable"

    x = np.arange(len(predictions))
    y = np.array(predictions)
    slope, _ = np.polyfit(x, y, 1)

    mean_val = np.mean(y)
    if mean_val == 0:
        return "stable"

    relative_slope = slope / mean_val

    if relative_slope > 0.02:
        return "up"
    elif relative_slope < -0.02:
        return "down"
    else:
        return "stable"


def get_seasonality_analysis(product_id, daily_df=None):
    from models.train import get_seasonal_patterns

    if daily_df is None or daily_df.empty:
        return get_seasonal_patterns(product_id)

    daily = daily_df.copy()
    daily["month"] = daily["sale_date"].dt.month
    daily["day_of_week"] = daily["sale_date"].dt.dayofweek
    daily["day_name"] = daily["sale_date"].dt.day_name()
    daily["month_name"] = daily["sale_date"].dt.month_name()

    monthly = daily.groupby(["month", "month_name"])["total_quantity"].mean().reset_index()
    monthly["avg_quantity"] = monthly["total_quantity"].round(2)
    monthly_patterns = monthly.sort_values("month")[
        ["month", "month_name", "avg_quantity"]
    ].to_dict("records")

    dow = daily.groupby(["day_of_week", "day_name"])["total_quantity"].mean().reset_index()
    dow["avg_quantity"] = dow["total_quantity"].round(2)
    day_of_week_patterns = dow.sort_values("day_of_week")[
        ["day_of_week", "day_name", "avg_quantity"]
    ].to_dict("records")

    seasonal_peaks = monthly.nlargest(3, "total_quantity")[
        ["month", "month_name", "avg_quantity"]
    ].to_dict("records")

    return {
        "monthly_patterns": monthly_patterns,
        "day_of_week_patterns": day_of_week_patterns,
        "seasonal_peaks": seasonal_peaks,
    }
