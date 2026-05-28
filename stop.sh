#!/bin/bash
echo "Stopping services..."

kill $(lsof -ti:8000) 2>/dev/null && echo "Backend stopped" || echo "Backend not running"
kill $(lsof -ti:5002) 2>/dev/null && echo "ML service stopped" || echo "ML service not running"

echo "Done."
