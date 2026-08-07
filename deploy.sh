#!/bin/bash
set -e
set -o pipefail

# ═══════════════════════════════════════════════════════════
#  NEX ERP - One-Command Deployment Script
#  Usage: ./deploy.sh [frontend|backend|all]
# ═══════════════════════════════════════════════════════════

# Server config
SERVER_IP="94.136.188.176"
SERVER_USER="root"
SERVER_PASS="gN6V5aLNdI69"
REMOTE_DIR="/var/www/nex-erp"

# Local paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_DIR="$SCRIPT_DIR/backend"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✔]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✘]${NC} $1"; }
info()  { echo -e "${CYAN}[→]${NC} $1"; }

# ─── Helper: run command on remote server ───
remote() {
  sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "$1"
}

# ─── Helper: rsync to remote server ───
sync_to_remote() {
  sshpass -p "$SERVER_PASS" rsync -avz --delete \
    --exclude node_modules --exclude .git --exclude dist --exclude .angular --exclude .env \
    -e "ssh -o StrictHostKeyChecking=no" \
    "$1" "$SERVER_USER@$SERVER_IP:$2"
}

# ─── Deploy Frontend ───
deploy_frontend() {
  echo ""
  echo "══════════════════════════════════════"
  echo "  🖥️  Deploying Frontend"
  echo "══════════════════════════════════════"

  info "Building Angular app for production..."
  # cd "$FRONTEND_DIR"
  # NODE_OPTIONS="--max-old-space-size=8192" npx ng build --configuration=production

  if [ ! -d "$FRONTEND_DIR/dist/frontend/browser" ]; then
    err "Build failed — dist/frontend/browser not found!"
    exit 1
  fi
  log "Frontend built successfully."

  info "Cleaning remote frontend directory..."
  remote "rm -rf $REMOTE_DIR/frontend/*"

  info "Uploading frontend to server..."
  sync_to_remote "$FRONTEND_DIR/dist/frontend/browser/" "$REMOTE_DIR/frontend/"
  log "Frontend deployed!"
}

# ─── Deploy Backend ───
deploy_backend() {
  echo ""
  echo "══════════════════════════════════════"
  echo "  ⚙️  Deploying Backend"
  echo "══════════════════════════════════════"

  info "Syncing backend code to server..."
  sync_to_remote "$BACKEND_DIR/" "$REMOTE_DIR/backend/"
  log "Code synced."

  info "Installing dependencies on server..."
  remote "cd $REMOTE_DIR/backend && npm install"
  log "Dependencies installed."

  info "Running Prisma migrations..."
  remote "cd $REMOTE_DIR/backend && npx prisma db push --accept-data-loss && npx prisma generate"
  log "Database synced."

  info "Building backend on server..."
  remote "cd $REMOTE_DIR/backend && npm run build"
  log "Backend built."

  info "Restarting PM2 process..."
  remote "cd $REMOTE_DIR/backend && pm2 restart nex-erp-backend --update-env || pm2 start dist/main.js --name nex-erp-backend"
  remote "pm2 save"
  log "Backend restarted!"
}

# ─── Main ───
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     🚀  NEX ERP Deployment Script       ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Server: $SERVER_IP              ║"
echo "║  Domain: nex.ces-pl.com                  ║"
echo "╚══════════════════════════════════════════╝"

# Check for sshpass
if ! command -v sshpass &> /dev/null; then
  warn "sshpass not found. Installing..."
  brew install hudochenkov/sshpass/sshpass 2>/dev/null || {
    err "Could not install sshpass. Please install it manually:"
    err "  brew install hudochenkov/sshpass/sshpass"
    exit 1
  }
fi

TARGET="${1:-all}"

case "$TARGET" in
  frontend)
    deploy_frontend
    ;;
  backend)
    deploy_backend
    ;;
  all)
    deploy_frontend
    deploy_backend
    ;;
  *)
    err "Unknown target: $TARGET"
    echo "Usage: ./deploy.sh [frontend|backend|all]"
    exit 1
    ;;
esac

echo ""
echo "══════════════════════════════════════"
echo "  ✅  Deployment Complete!"
echo "  🌐  https://nex.ces-pl.com"
echo "══════════════════════════════════════"
echo ""
