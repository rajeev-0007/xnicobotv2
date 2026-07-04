#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

cleanup() {
    echo -e "\n${YELLOW}[*] Shutting down...${NC}"
    if [ -n "$DASHBOARD_PID" ] && kill -0 "$DASHBOARD_PID" 2>/dev/null; then
        echo -e "${CYAN}[*] Stopping dashboard (PID $DASHBOARD_PID)...${NC}"
        kill "$DASHBOARD_PID" 2>/dev/null
        wait "$DASHBOARD_PID" 2>/dev/null
    fi
    if [ -n "$SHARD_PID" ] && kill -0 "$SHARD_PID" 2>/dev/null; then
        echo -e "${CYAN}[*] Stopping shard.js (PID $SHARD_PID)...${NC}"
        kill "$SHARD_PID" 2>/dev/null
        wait "$SHARD_PID" 2>/dev/null
    fi
    pkill -f "node.*index.js" 2>/dev/null
    echo -e "${GREEN}[✓] All processes stopped.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

pkill -f "node.*shard.js" 2>/dev/null
pkill -f "node.*index.js" 2>/dev/null
pkill -f "node.*dashboard/server.js" 2>/dev/null

# ── Install dashboard dependencies if needed ──
if [ -d "$SCRIPT_DIR/dashboard" ] && [ ! -d "$SCRIPT_DIR/dashboard/node_modules" ]; then
    echo -e "${CYAN}[*] Installing dashboard dependencies...${NC}"
    cd "$SCRIPT_DIR/dashboard" && npm install --production 2>/dev/null
    cd "$SCRIPT_DIR"
fi

echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       Starting xNico Bot + Dashboard                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"

# ── Start Dashboard ──
if [ -f "$SCRIPT_DIR/dashboard/server.js" ]; then
    node "$SCRIPT_DIR/dashboard/server.js" &
    DASHBOARD_PID=$!
    echo -e "${MAGENTA}[✓] Dashboard started (PID $DASHBOARD_PID) → http://localhost:${DASHBOARD_PORT:-3500}${NC}"
fi

# ── Start Bot ──
node "$SCRIPT_DIR/shard.js" &
SHARD_PID=$!

echo -e "${GREEN}[✓] shard.js started (PID $SHARD_PID)${NC}"
echo -e "${YELLOW}[*] Press Ctrl+C to stop all.${NC}"
echo ""

wait "$SHARD_PID" 2>/dev/null

echo -e "${RED}[!] Process exited unexpectedly.${NC}"
cleanup
