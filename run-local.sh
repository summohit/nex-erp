#!/bin/bash
# Script to run both backend and frontend locally

echo "=========================================="
echo "🚀 Starting NEX ERP Locally"
echo "=========================================="

echo "[→] Cleaning up any orphaned processes on port 3000 or 4200..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:4200 | xargs kill -9 2>/dev/null || true

# Function to handle cleanup on exit
cleanup() {
    echo "Stopping servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

# Catch termination signals
trap cleanup SIGINT SIGTERM

echo "[→] Starting NestJS Backend..."
cd backend && npm run start:dev &
BACKEND_PID=$!
cd ..

echo "[→] Starting Angular Frontend..."
cd frontend && npm start &
FRONTEND_PID=$!
cd ..

echo "=========================================="
echo "✅ Both servers are starting up!"
echo "Backend API typically at: http://localhost:3000"
echo "Frontend UI typically at: http://localhost:4200"
echo "Press Ctrl+C to stop both servers."
echo "=========================================="

# Wait for background processes
wait $BACKEND_PID $FRONTEND_PID
