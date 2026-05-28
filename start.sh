#!/bin/bash

# Start ML service in background
cd /app/ml-service
python3 -m pip install -r requirements.txt -q
gunicorn -w 2 -b 0.0.0.0:5002 app:app &

# Wait for ML service to start
sleep 3

# Start backend
cd /app/backend
node server.js
