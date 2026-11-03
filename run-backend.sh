#!/bin/bash
echo "=========================================="
echo "⚙️  Starting NestJS Backend (Port 3000)"
echo "=========================================="

echo "[→] Cleaning up any orphaned processes on port 3000..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

cd backend
# The TypeScript watcher keeps every recompile in memory; with this schema it
# outgrows Node's default ~2 GB heap after a long session ("heap out of memory").
export NODE_OPTIONS="--max-old-space-size=4096 ${NODE_OPTIONS:-}"
npm run start:dev
