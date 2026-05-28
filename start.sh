#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting ML service (Gunicorn)..."
nohup gunicorn -w 2 -b 0.0.0.0:5002 --access-logfile "$DIR/ml-service/ml.log" --error-logfile "$DIR/ml-service/ml.log" --chdir "$DIR/ml-service" app:app &
ML_PID=$!
echo "ML service (PID $ML_PID) — http://localhost:5002"

echo "Starting backend..."
nohup node "$DIR/backend/server.js" > "$DIR/backend/server.log" 2>&1 &
BACKEND_PID=$!
echo "Backend (PID $BACKEND_PID) — http://localhost:8000"

echo ""
echo "Services starting... check logs for errors."
echo "  ML:  $DIR/ml-service/ml.log"
echo "  API: $DIR/backend/server.log"
