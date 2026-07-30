#!/usr/bin/env bash
# Post-deploy smoke for BudgetBasket TEST contour (SE 2.0: verify-first).
# Usage (on VPS or from CI after SSH):
#   BUDGETBASKET_FQDN=budgetbasket.acom-offer-desk.ru bash scripts/post-deploy-verify.sh
set -euo pipefail

FQDN="${BUDGETBASKET_FQDN:-budgetbasket.acom-offer-desk.ru}"
BASE="https://${FQDN}"
# Fail-closed timeouts (seconds)
CURL=(curl -fsS --connect-timeout 10 --max-time 30)

echo "POST_DEPLOY_VERIFY fqdn=${FQDN}"

# App health (backend via public URL if exposed; nginx maps /api/* → backend /*)
"${CURL[@]}" "${BASE}/api/health" | tee /tmp/bb-health.json >/dev/null
echo "OK /api/health"

# DB health through same API prefix
"${CURL[@]}" "${BASE}/api/health/db" | tee /tmp/bb-health-db.json >/dev/null
echo "OK /api/health/db"

# SPA / origin reachable (expect HTML or redirect handled by -f for 2xx/3xx? -f fails on 3xx... use -L)
code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 -L "${BASE}/")"
case "${code}" in
  200) echo "OK / → HTTP ${code}" ;;
  *)
    echo "FAIL / → HTTP ${code}" >&2
    exit 1
    ;;
esac

if [[ -d .git ]]; then
  echo "DEPLOYED_SHA=$(git rev-parse HEAD)"
fi

echo "POST_DEPLOY_VERIFY_PASS"
