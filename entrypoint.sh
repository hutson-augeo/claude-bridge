#!/bin/sh
# entrypoint.sh — Docker runtime init
#
# Runs before the Node.js server on every container start.
# On first run (empty data volume) it creates config.json with
# Docker-appropriate defaults so the user never has to touch a file.
set -e

CONFIG="${CLAUDE_BRIDGE_CONFIG:-/app/config.json}"

# ── First-run initialisation ──────────────────────────────────────────────────
if [ ! -f "$CONFIG" ]; then
  echo ""
  echo "  Claude Bridge — first run"
  echo "  Initialising config at ${CONFIG}..."

  CLAUDE_BRIDGE_CONFIG="$CONFIG" node -e "
    const fs   = require('fs');
    const path = require('path');
    const cfg  = JSON.parse(fs.readFileSync('/app/config.example.json', 'utf8'));

    // Docker defaults: bind all interfaces, store tokens on the data volume
    cfg.host           = '0.0.0.0';
    cfg.tokenStorePath = './data/.tokens.json';

    const dest = process.env.CLAUDE_BRIDGE_CONFIG;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(cfg, null, 2) + '\n');
    console.log('  \u2713  Config ready: ' + dest);
  "
  echo ""
fi

# ── Hand off to CMD (node dist/index.js) ─────────────────────────────────────
exec "$@"
