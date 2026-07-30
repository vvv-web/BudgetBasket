#!/usr/bin/env bash
# Post-deploy smoke for BudgetBasket TEST contour (SE 2.0: verify-first).
# Retries briefly: compose just started → nginx may 502 until backend is up.
set -euo pipefail

FQDN="${BUDGETBASKET_FQDN:-budgetbasket.acom-offer-desk.ru}"
BASE="https://${FQDN}"
ATTEMPTS="${POST_DEPLOY_ATTEMPTS:-30}"
SLEEP_SEC="${POST_DEPLOY_SLEEP_SEC:-3}"

echo "POST_DEPLOY_VERIFY fqdn=${FQDN} attempts=${ATTEMPTS}"

wait_url() {
  local url="$1"
  local name="$2"
  local i=1
  local code body
  while (( i <= ATTEMPTS )); do
    code="$(curl -sS -o /tmp/bb-smoke-body -w '%{http_code}' --connect-timeout 10 --max-time 30 "${url}" || true)"
    if [[ "${code}" == "200" ]]; then
      echo "OK ${name} → HTTP ${code} (try ${i})"
      return 0
    fi
    echo "wait ${name} try ${i}/${ATTEMPTS} → HTTP ${code:-curl-fail}"
    sleep "${SLEEP_SEC}"
    i=$((i + 1))
  done
  echo "FAIL ${name} after ${ATTEMPTS} tries" >&2
  if [[ -f /tmp/bb-smoke-body ]]; then
    head -c 400 /tmp/bb-smoke-body >&2 || true
    echo >&2
  fi
  return 1
}

wait_url "${BASE}/api/health" "/api/health"
wait_url "${BASE}/api/health/db" "/api/health/db"

code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 -L "${BASE}/" || true)"
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
