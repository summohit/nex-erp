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

# SSH connection multiplexing: authenticate once, reuse the same socket for every
# subsequent ssh/rsync call in this run instead of opening a fresh connection each
# time. Fewer connection attempts = far less likely to trip the server's rate limiter.
CTRL_DIR="/tmp/nex-erp-deploy-ctrl"
mkdir -p "$CTRL_DIR"
CTRL_PATH="$CTRL_DIR/%r@%h:%p"
SSH_OPTS=(-o StrictHostKeyChecking=no -o ControlMaster=auto -o ControlPath="$CTRL_PATH" -o ControlPersist=600)

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

# ─── Helper: open the shared SSH master connection (authenticates once) ───
open_master() {
  if ! ssh -O check -o ControlPath="$CTRL_PATH" "$SERVER_USER@$SERVER_IP" 2>/dev/null; then
    info "Opening SSH connection to server..."
    sshpass -p "$SERVER_PASS" ssh "${SSH_OPTS[@]}" -MNf "$SERVER_USER@$SERVER_IP"
  fi
}

# ─── Helper: close the shared SSH master connection ───
close_master() {
  ssh -O exit -o ControlPath="$CTRL_PATH" "$SERVER_USER@$SERVER_IP" 2>/dev/null || true
}

# ─── Helper: run command on remote server ───
remote() {
  ssh "${SSH_OPTS[@]}" "$SERVER_USER@$SERVER_IP" "$1"
}

# ─── Helper: rsync to remote server ───
sync_to_remote() {
  rsync -avz --delete \
    --exclude node_modules --exclude .git --exclude dist --exclude .angular --exclude .env \
    --exclude uploads \
    -e "ssh ${SSH_OPTS[*]}" \
    "$1" "$SERVER_USER@$SERVER_IP:$2"
}

# ─── Deploy Frontend ───
deploy_frontend() {
  echo ""
  echo "══════════════════════════════════════"
  echo "  🖥️  Deploying Frontend"
  echo "══════════════════════════════════════"

  info "Syncing frontend source code to server..."
  sync_to_remote "$FRONTEND_DIR/" "$REMOTE_DIR/frontend_src/"
  
  info "Installing frontend dependencies on server..."
  remote "cd $REMOTE_DIR/frontend_src && npm install --legacy-peer-deps"
  
  info "Building Angular app for production on server..."
  remote "cd $REMOTE_DIR/frontend_src && npm run build"
  
  info "Deploying frontend to web directory..."
  remote "rm -rf $REMOTE_DIR/frontend/*"
  remote "mkdir -p $REMOTE_DIR/frontend"
  remote "cp -r $REMOTE_DIR/frontend_src/dist/frontend/browser/* $REMOTE_DIR/frontend/ 2>/dev/null || mv $REMOTE_DIR/frontend_src/dist/frontend/browser/* $REMOTE_DIR/frontend/"
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
  remote "cd $REMOTE_DIR/backend && npm install --legacy-peer-deps"
  log "Dependencies installed."

  info "Running Prisma migrations..."
  remote "cd $REMOTE_DIR/backend && export DIRECT_URL=\$(grep DATABASE_URL .env | cut -d'\"' -f2 | sed 's/6543/5432/' | sed 's/?pgbouncer=true//') && DATABASE_URL=\"\$DIRECT_URL\" npx prisma db push --accept-data-loss && npx prisma generate"
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

trap close_master EXIT
open_master

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
