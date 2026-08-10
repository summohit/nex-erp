#!/bin/bash
echo "=========================================="
echo "🖥️  Starting Angular Frontend (Port 4200)"
echo "=========================================="

echo "[→] Cleaning up any orphaned processes on port 4200..."
lsof -ti:4200 | xargs kill -9 2>/dev/null || true

cd frontend
npm start
