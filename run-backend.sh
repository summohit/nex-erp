#!/bin/bash
echo "=========================================="
echo "⚙️  Starting NestJS Backend (Port 3000)"
echo "=========================================="

echo "[→] Cleaning up any orphaned processes on port 3000..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

cd backend
npm run start:dev
