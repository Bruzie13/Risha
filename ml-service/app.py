import os
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import datetime

from models.train import (
    fetch_sales_data,
    prepare_features,
    train_models,
    save_models,
    load_models,
    needs_retrain,
    get_seasonal_patterns,
    get_db_connection,
)
from models.predict import (
    predict_demand,
    calculate_reorder_recommendation,
    get_confidence_score,
    detect_trend,
    get_seasonality_analysis,
)

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

app = Flask(__name__)
CORS(app)

ML_PORT = int(os.getenv("ML_PORT", "5002"))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "success": True,
        "status": "healthy",
        "service": "ml-demand-forecast",
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/api/predictions/product/<int:product_id>", methods=["GET"])
def get_product_prediction(product_id):
    try:
        current_stock = request.args.get("stock", default=0, type=float)
        reorder_level = request.args.get("reorder_level", default=0, type=float)
        lead_time = request.args.get("lead_time", default=7, type=int)

        sales_df = fetch_sales_data(product_id)
        if sales_df.empty:
            return jsonify({
                "success": False,
                "error": f"No sales data found for product {product_id}",
            }), 404

        product_name = sales_df["product_name"].iloc[0]
        daily_df, feature_cols = prepare_features(sales_df)

        if daily_df is None or daily_df.empty or len(daily_df) < 5:
            return jsonify({
                "success": False,
                "error": f"Insufficient sales history for product {product_id} (need at least 5 days)",
            }), 400

        model_data = load_models(product_id)
        should_retrain = model_data is None or needs_retrain(product_id)

        if should_retrain:
            X = daily_df[feature_cols]
            y = daily_df["total_quantity"]

            model_data = train_models(X, y)
            save_models(model_data, product_id)
            model_data = load_models(product_id)

        feature_cols_actual = model_data["metadata"].get("feature_cols", feature_cols)

        predictions, future_dates = predict_demand(
            model_data, historical_df=daily_df, days=30
        )

        next_month_prediction = float(np.sum(predictions[:30]) if len(predictions) >= 30 else sum(predictions))

        eval_features = feature_cols_actual if feature_cols_actual else feature_cols
        X_eval = daily_df[eval_features]
        y_eval = daily_df["total_quantity"]

        if len(y_eval) >= 2:
            split = min(5, max(1, len(X_eval) // 5))
            X_test = X_eval.iloc[-split:] if len(X_eval) > split else X_eval
            y_test = y_eval.iloc[-split:] if len(y_eval) > split else y_eval
        else:
            X_test, y_test = X_eval, y_eval

        y_pred = (model_data["rf_model"].predict(X_test) + model_data["gb_model"].predict(X_test)) / 2

        confidence = get_confidence_score(y_test.values, y_pred)

        trend = detect_trend(predictions)

        seasonality = get_seasonality_analysis(product_id, daily_df)

        historical_records = daily_df.sort_values("sale_date").tail(90)
        historical_data = []
        for _, row in historical_records.iterrows():
            historical_data.append({
                "date": row["sale_date"].strftime("%Y-%m-%d"),
                "quantity": float(row["total_quantity"]),
            })

        prediction_records = []
        for i, (pred_date, pred_val) in enumerate(zip(future_dates, predictions)):
            prediction_records.append({
                "date": pred_date.strftime("%Y-%m-%d"),
                "predicted_quantity": round(float(pred_val), 2),
                "day": i + 1,
            })

        reorder = calculate_reorder_recommendation(
            predictions, current_stock=current_stock,
            reorder_level=reorder_level, lead_time_days=lead_time
        )

        return jsonify({
            "success": True,
            "data": {
                "product_id": product_id,
                "product_name": product_name,
                "historical_data": historical_data,
                "predictions": prediction_records,
                "next_month_prediction": round(next_month_prediction, 2),
                "confidence_score": confidence["confidence_score"],
                "trend": trend,
                "seasonality": seasonality,
                "reorder_recommendation": reorder,
                "model_retrained": should_retrain,
            },
        })

    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        return jsonify({"success": False, "error": f"Prediction error: {str(e)}"}), 500


@app.route("/api/predictions/all", methods=["GET"])
def get_all_predictions():
    try:
        sales_df = fetch_sales_data()
        if sales_df.empty:
            return jsonify({
                "success": True,
                "data": [],
            })

        product_ids = sales_df["product_id"].unique()
        all_predictions = []

        for pid in product_ids:
            product_sales = sales_df[sales_df["product_id"] == pid].copy()
            if len(product_sales) < 5:
                continue

            product_name = product_sales["product_name"].iloc[0]
            daily_df, feature_cols = prepare_features(product_sales)

            if daily_df is None or daily_df.empty or len(daily_df) < 5:
                continue

            model_data = load_models(pid)
            should_retrain = model_data is None or needs_retrain(pid)

            if should_retrain:
                X = daily_df[feature_cols]
                y = daily_df["total_quantity"]
                model_data = train_models(X, y)
                save_models(model_data, pid)
                model_data = load_models(pid)

            predictions, _ = predict_demand(model_data, historical_df=daily_df, days=30)
            next_month = float(np.sum(predictions[:30]))
            trend = detect_trend(predictions)

            all_predictions.append({
                "product_id": int(pid),
                "product_name": product_name,
                "next_month_prediction": round(next_month, 2),
                "trend": trend,
                "confidence_score": model_data["metadata"].get("ensemble_score", 0) * 100,
                "model_retrained": should_retrain,
            })

        all_predictions.sort(key=lambda x: x["next_month_prediction"], reverse=True)

        return jsonify({
            "success": True,
            "data": {
                "total_products": len(all_predictions),
                "predictions": all_predictions,
            },
        })

    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        return jsonify({"success": False, "error": f"Error: {str(e)}"}), 500


@app.route("/api/predictions/summary", methods=["GET", "OPTIONS"])
def get_prediction_summary():
    try:
        sales_df = fetch_sales_data()
        seasonal = get_seasonal_patterns()
        seasonal_trends = seasonal.get("monthly_patterns", [])

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, name, stock_quantity, reorder_level, max_stock_level, sku FROM products WHERE is_active = TRUE"
        )
        products = cursor.fetchall()
        cursor.close()
        conn.close()

        product_ids = sales_df["product_id"].unique() if not sales_df.empty else []
        recommendations = []

        for product in products:
            pid = product["id"]
            stock = float(product["stock_quantity"] or 0)
            reorder_level = float(product["reorder_level"] or 10)

            if pid in product_ids:
                product_sales = sales_df[sales_df["product_id"] == pid].copy()
                if len(product_sales) >= 5:
                    daily_df, feature_cols = prepare_features(product_sales)
                    if daily_df is not None and not daily_df.empty and len(daily_df) >= 5:
                        model_data = load_models(pid)
                        should_retrain = model_data is None or needs_retrain(pid)
                        if should_retrain:
                            X = daily_df[feature_cols]
                            y = daily_df["total_quantity"]
                            model_data = train_models(X, y)
                            save_models(model_data, pid)
                            model_data = load_models(pid)
                        predictions, _ = predict_demand(model_data, historical_df=daily_df, days=30)
                        reorder = calculate_reorder_recommendation(
                            predictions, current_stock=stock, reorder_level=reorder_level
                        )
                        if reorder["reorder_triggered"]:
                            recommendations.append({
                                "product_name": product["name"],
                                "current_stock": stock,
                                "reorder_level": reorder_level,
                                "recommended_qty": reorder["suggested_order_quantity"],
                                "priority": "High" if reorder["days_until_stockout"] <= 7 else "Medium",
                            })
            else:
                if stock <= reorder_level:
                    recommendations.append({
                        "product_name": product["name"],
                        "current_stock": stock,
                        "reorder_level": reorder_level,
                        "recommended_qty": reorder_level * 2 - stock if stock < reorder_level else 0,
                        "priority": "Low",
                    })

        recommendations.sort(key=lambda r: r["current_stock"])

        return jsonify({
            "success": True,
            "data": {
                "seasonal_trends": seasonal_trends,
                "reorder_recommendations": recommendations[:20],
            },
        })
    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        return jsonify({"success": False, "error": f"Summary error: {str(e)}"}), 500


@app.route("/api/predictions/retrain", methods=["POST"])
def retrain_models():
    try:
        sales_df = fetch_sales_data()
        if sales_df.empty:
            return jsonify({
                "success": False,
                "error": "No sales data available for retraining",
            }), 400

        product_ids = sales_df["product_id"].unique()
        results = []
        errors = []

        for pid in product_ids:
            try:
                product_sales = sales_df[sales_df["product_id"] == pid].copy()
                product_name = product_sales["product_name"].iloc[0]

                if len(product_sales) < 5:
                    errors.append({
                        "product_id": int(pid),
                        "product_name": product_name,
                        "error": "Insufficient data (need >= 5 records)",
                    })
                    continue

                daily_df, feature_cols = prepare_features(product_sales)
                if daily_df is None or daily_df.empty or len(daily_df) < 5:
                    errors.append({
                        "product_id": int(pid),
                        "product_name": product_name,
                        "error": "Insufficient data after feature preparation",
                    })
                    continue

                X = daily_df[feature_cols]
                y = daily_df["total_quantity"]

                model_data = train_models(X, y)
                save_models(model_data, pid)

                results.append({
                    "product_id": int(pid),
                    "product_name": product_name,
                    "r2_score": round(model_data["ensemble_score"], 4),
                    "mape": round(model_data["mape"], 2),
                })

            except Exception as e:
                errors.append({
                    "product_id": int(pid),
                    "error": str(e),
                })

        return jsonify({
            "success": True,
            "data": {
                "total_retrained": len(results),
                "total_errors": len(errors),
                "results": results,
                "errors": errors,
            },
        })

    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        return jsonify({"success": False, "error": f"Retrain error: {str(e)}"}), 500


@app.route("/api/predictions/trends", methods=["GET"])
def get_trends():
    product_id = request.args.get("product_id", default=None, type=int)

    try:
        patterns = get_seasonal_patterns(product_id)

        sales_df = fetch_sales_data(product_id)
        trend_summary = {}

        if not sales_df.empty:
            daily_agg = sales_df.groupby("sale_date")["quantity"].sum().reset_index()
            daily_agg.columns = ["sale_date", "total_quantity"]
            daily_agg = daily_agg.sort_values("sale_date")

            if len(daily_agg) >= 7:
                daily_agg["7_day_avg"] = daily_agg["total_quantity"].rolling(7).mean()
                daily_agg["30_day_avg"] = daily_agg["total_quantity"].rolling(30).mean()

                recent = daily_agg.tail(30)
                if not recent.empty and len(recent) >= 2:
                    x = np.arange(len(recent))
                    y = recent["total_quantity"].values
                    slope = np.polyfit(x, y, 1)[0]
                    trend_summary["recent_slope"] = round(float(slope), 4)
                    trend_summary["recent_direction"] = "up" if slope > 0 else ("down" if slope < 0 else "stable")

                trend_summary["total_sales_days"] = len(daily_agg)
                trend_summary["date_range"] = {
                    "start": daily_agg["sale_date"].min().strftime("%Y-%m-%d"),
                    "end": daily_agg["sale_date"].max().strftime("%Y-%m-%d"),
                }

        return jsonify({
            "success": True,
            "data": {
                "product_id": product_id,
                "seasonality": patterns,
                "trend_summary": trend_summary,
            },
        })

    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        return jsonify({"success": False, "error": f"Trend analysis error: {str(e)}"}), 500


if __name__ == "__main__":
    os.makedirs(os.path.join(os.path.dirname(__file__), "models"), exist_ok=True)
    print(f"ML Demand Forecasting Service starting on port {ML_PORT}...")
    app.run(host="0.0.0.0", port=ML_PORT, debug=False, use_reloader=False, threaded=True)
