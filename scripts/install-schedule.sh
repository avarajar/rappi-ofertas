#!/usr/bin/env bash
#
# Programa las corridas automaticas con launchd (macOS).
#
# Se usa launchd y no cron a proposito: si el Mac estaba dormido a la hora
# programada, launchd ejecuta el trabajo al despertar. Cron pierde esa corrida
# en silencio, que es justo el modo de fallo que no queremos aqui.
#
# Uso:
#   ./scripts/install-schedule.sh              # 11:00, 17:00 y 20:00
#   ./scripts/install-schedule.sh 9 14 19 22   # las horas que quieras
set -euo pipefail

LABEL="com.rappi-ofertas.check"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

HOURS=("${@:-}")
if [ -z "${1:-}" ]; then HOURS=(11 17 20); fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "No encontre node en el PATH. Instalalo o ajusta NODE_BIN a mano." >&2
  exit 1
fi

if [ ! -f "$PROJECT_DIR/dist/cli.js" ]; then
  echo "Falta dist/cli.js. Corre 'npm run build' antes de programar." >&2
  exit 1
fi

if [ ! -d "$PROJECT_DIR/.browser-profile" ]; then
  echo "Aviso: no existe .browser-profile/. Corre 'npm run login' o las" >&2
  echo "corridas programadas van a fallar con SESSION." >&2
fi

intervals=""
for h in "${HOURS[@]}"; do
  intervals+="    <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>
"
done

mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT_DIR/logs"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>dist/cli.js</string>
    <string>check</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$PROJECT_DIR</string>

  <key>StartCalendarInterval</key>
  <array>
$intervals  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>StandardOutPath</key>
  <string>$PROJECT_DIR/logs/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$PROJECT_DIR/logs/launchd.log</string>

  <!-- Sin relanzado automatico: reintentar rapido es lo que dispara el
       throttling de Rappi, y el fallo ya se avisa por Discord. -->
  <key>KeepAlive</key>
  <false/>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST_EOF

plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Programado: $LABEL"
echo "Horas: ${HOURS[*]} (en punto)"
echo "Plist: $PLIST"
echo
echo "Verifica:   launchctl list | grep rappi"
echo "Dispara ya: launchctl kickstart -p gui/$(id -u)/$LABEL"
echo "Quita:      ./scripts/uninstall-schedule.sh"
