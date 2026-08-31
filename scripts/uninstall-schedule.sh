#!/usr/bin/env bash
# Quita las corridas automaticas. No borra el perfil ni los logs.
set -euo pipefail
LABEL="com.rappi-ofertas.check"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Desprogramado. El perfil del navegador y los logs siguen intactos."
