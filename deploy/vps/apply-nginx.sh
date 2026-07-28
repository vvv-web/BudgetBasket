#!/usr/bin/env bash
# Apply BudgetBasket nginx site (API /api → backend, SPA → frontend).
# Run on acom-VPS after green CI. Requires sudo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SITE_SRC="${REPO_ROOT}/deploy/nginx/budgetbasket.acom-offer-desk.ru.conf"
SITE_NAME="budgetbasket.acom-offer-desk.ru"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/etc/nginx/sites-available/${SITE_NAME}.bak-${STAMP}"

if [[ ! -f "$SITE_SRC" ]]; then
  echo "Missing $SITE_SRC" >&2
  exit 1
fi

sudo cp "/etc/nginx/sites-available/${SITE_NAME}" "$BACKUP" 2>/dev/null || true
sudo cp "$SITE_SRC" "/etc/nginx/sites-available/${SITE_NAME}"
sudo ln -sf "/etc/nginx/sites-available/${SITE_NAME}" "/etc/nginx/sites-enabled/${SITE_NAME}"
sudo nginx -t
sudo systemctl reload nginx
echo "OK: nginx reloaded (backup: ${BACKUP})"
