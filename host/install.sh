#!/bin/sh
# Register the OCR Clipper native messaging host on macOS / Linux (current user).
# Usage: sh host/install.sh [extension-id ...]
# The default ID is the unpacked dev build; pass the Chrome Web Store ID too after publishing.
set -e
[ $# -gt 0 ] || set -- alniecnjlgpfdfolhnmflgcjmomdianc
ORIGINS=""
for id in "$@"; do ORIGINS="$ORIGINS${ORIGINS:+, }\"chrome-extension://$id/\""; done
HOST_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found in PATH; install Node.js 18+ first" >&2; exit 1; }

LAUNCHER="$HOST_DIR/ocr-clipper-host.sh"
# Browsers start native hosts with a minimal PATH; keep the install-time PATH so agent CLIs are found.
cat > "$LAUNCHER" <<EOF
#!/bin/sh
export PATH="$PATH"
exec "$NODE" "$HOST_DIR/host.cjs" "\$@"
EOF
chmod +x "$LAUNCHER"

MANIFEST=$(cat <<EOF
{
  "name": "com.ocrclipper.host",
  "description": "OCR Clipper native host",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": [$ORIGINS]
}
EOF
)

if [ "$(uname)" = "Darwin" ]; then
  DIRS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts
$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts
$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts
$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
else
  DIRS="$HOME/.config/google-chrome/NativeMessagingHosts
$HOME/.config/microsoft-edge/NativeMessagingHosts
$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts
$HOME/.config/chromium/NativeMessagingHosts"
fi

echo "$DIRS" | while IFS= read -r d; do
  mkdir -p "$d"
  printf '%s\n' "$MANIFEST" > "$d/com.ocrclipper.host.json"
  echo "installed: $d/com.ocrclipper.host.json"
done
echo "Reload the extension and click 'detect' in the settings tab."
