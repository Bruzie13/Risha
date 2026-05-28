import os
import numpy as np
import pandas as pd
import mysql.connector
from mysql.connector import pooling
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import r2_score, mean_absolute_error
from sklearn.model_selection import train_test_split
import joblib
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "risha_pet_supplies"),
}

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
RETRAIN_INTERVAL = int(os.getenv("RETRAIN_DAYS", "7"))

connection_pool = None


def get_connection_pool():
    global connection_pool
    if connection_pool is None:
        connection_pool = pooling.MySQLConnectionPool(
            pool_name="ml_pool",
            pool_size=5,
            pool_reset_session=True,
            **DB_CONFIG,
        )
    return connection_pool


def get_db_connection():
    pool = get_connection_pool()
    return pool.get_connection()


def fetch_sales_data(product_id=None):
    base_query = """
        SELECT
            s.id AS sale_id,
            s.created_at as sale_date,
            si.product_id,
            p.name AS product_name,
            si.quantity,
            si.unit_price,
            si.subtotal
        FROM sales s
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        WHERE s.payment_status = 'completed'
    """
    params = []

    if product_id is not None:
        base_query += " AND si.product_id = %s"
        params.append(product_id)

    base_query += " ORDER BY sale_date ASC"

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(base_query, params)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        if not rows:
            return pd.DataFrame()

        df = pd.DataFrame(rows)
        df["sale_date"] = pd.to_datetime(df["sale_date"])
        # Convert Decimal columns to float for ML compatibility
        for col in ['quantity', 'unit_price', 'subtotal']:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').astype(float)
        return df

    except mysql.connector.Error as e:
        raise RuntimeError(f"Database error: {e}")
    except Exception as e:
        raise RuntimeError(f"Error fetching sales data: {e}")


def prepare_features(df):
    if df.empty:
        return None, None

    daily = df.groupby(["product_id", "sale_date"]).agg(
        total_quantity=("quantity", "sum"),
        total_revenue=("subtotal", "sum"),
    ).reset_index()

    daily["day_of_week"] = daily["sale_date"].dt.dayofweek
    daily["day_of_month"] = daily["sale_date"].dt.day
    daily["month"] = daily["sale_date"].dt.month
    daily["year"] = daily["sale_date"].dt.year
    daily["day_of_year"] = daily["sale_date"].dt.dayofyear
    daily["is_weekend"] = (daily["day_of_week"] >= 5).astype(int)

    holiday_months = [11, 12, 1]
    daily["is_holiday_season"] = daily["month"].isin(holiday_months).astype(int)

    daily["lag_1"] = daily.groupby("product_id")["total_quantity"].shift(1)
    daily["lag_7"] = daily.groupby("product_id")["total_quantity"].shift(7)
    daily["lag_14"] = daily.groupby("product_id")["total_quantity"].shift(14)
    daily["rolling_mean_7"] = (
        daily.groupby("product_id")["total_quantity"]
        .transform(lambda x: x.rolling(window=7, min_periods=1).mean())
    )
    daily["rolling_mean_14"] = (
        daily.groupby("product_id")["total_quantity"]
        .transform(lambda x: x.rolling(window=14, min_periods=1).mean())
    )

    daily.fillna(0, inplace=True)

    feature_cols = [
        "day_of_week", "day_of_month", "month", "year",
        "day_of_year", "is_weekend", "is_holiday_season",
        "lag_1", "lag_7", "lag_14", "rolling_mean_7", "rolling_mean_14",
    ]

    return daily, feature_cols


def train_models(X, y):
    if len(X) < 5:
        raise ValueError("Insufficient data: need at least 5 samples")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, shuffle=False
    )

    rf = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    gb = GradientBoostingRegressor(n_estimators=100, random_state=42)

    rf.fit(X_train, y_train)
    gb.fit(X_train, y_train)

    rf_pred = rf.predict(X_test)
    gb_pred = gb.predict(X_test)
    ensemble_pred = (rf_pred + gb_pred) / 2

    rf_score = r2_score(y_test, rf_pred)
    gb_score = r2_score(y_test, gb_pred)
    ensemble_score = r2_score(y_test, ensemble_pred)

    mape = np.mean(np.abs((y_test - ensemble_pred) / (y_test + 1e-10))) * 100
    mae = mean_absolute_error(y_test, ensemble_pred)

    return {
        "rf_model": rf,
        "gb_model": gb,
        "rf_score": max(0, rf_score),
        "gb_score": max(0, gb_score),
        "ensemble_score": max(0, ensemble_score),
        "mape": mape,
        "mae": mae,
        "feature_cols": list(X.columns) if hasattr(X, "columns") else None,
    }


def save_models(model_dict, product_id):
    os.makedirs(MODELS_DIR, exist_ok=True)
    base_path = os.path.join(MODELS_DIR, f"product_{product_id}")

    joblib.dump(model_dict["rf_model"], f"{base_path}_rf.pkl")
    joblib.dump(model_dict["gb_model"], f"{base_path}_gb.pkl")

    metadata = {
        "rf_score": model_dict["rf_score"],
        "gb_score": model_dict["gb_score"],
        "ensemble_score": model_dict["ensemble_score"],
        "mape": model_dict["mape"],
        "mae": model_dict["mae"],
        "feature_cols": model_dict["feature_cols"],
        "trained_at": datetime.now().isoformat(),
    }
    joblib.dump(metadata, f"{base_path}_metadata.pkl")
    return base_path


def load_models(product_id):
    base_path = os.path.join(MODELS_DIR, f"product_{product_id}")

    if not os.path.exists(f"{base_path}_rf.pkl") or not os.path.exists(f"{base_path}_gb.pkl"):
        return None

    rf_model = joblib.load(f"{base_path}_rf.pkl")
    gb_model = joblib.load(f"{base_path}_gb.pkl")
    metadata = joblib.load(f"{base_path}_metadata.pkl")

    return {
        "rf_model": rf_model,
        "gb_model": gb_model,
        "metadata": metadata,
    }


def needs_retrain(product_id):
    base_path = os.path.join(MODELS_DIR, f"product_{product_id}_metadata.pkl")
    if not os.path.exists(base_path):
        return True

    metadata = joblib.load(base_path)
    trained_at = datetime.fromisoformat(metadata["trained_at"])
    days_since = (datetime.now() - trained_at).days
    return days_since >= RETRAIN_INTERVAL


def get_seasonal_patterns(product_id=None):
    df = fetch_sales_data(product_id)
    if df.empty:
        return {
            "monthly_patterns": [],
            "day_of_week_patterns": [],
            "seasonal_peaks": [],
        }

    daily = df.groupby(["product_id", "sale_date"]).agg(
        total_quantity=("quantity", "sum")
    ).reset_index()

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
