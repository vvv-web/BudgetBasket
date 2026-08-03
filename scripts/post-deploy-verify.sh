#!/usr/bin/env bash
# Post-deploy smoke for BudgetBasket TEST contour (SE 2.0: verify-first).
# Retries briefly: compose just started → nginx may 502 until backend is up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

wait_url "${BASE}/" "/"

# Login must work via /api (incident 2026-07-31: VITE_API_URL without /api → UI 404)
login_code="$(curl -sS -o /tmp/bb-smoke-login -w '%{http_code}' --connect-timeout 10 --max-time 30 \
  -X POST "${BASE}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"admin"}' || true)"
if [[ "${login_code}" != "200" ]]; then
  echo "FAIL /api/auth/login → HTTP ${login_code}" >&2
  head -c 400 /tmp/bb-smoke-login >&2 || true
  echo >&2
  exit 1
fi
if ! grep -q 'access_token' /tmp/bb-smoke-login; then
  echo "FAIL /api/auth/login: no access_token in body" >&2
  exit 1
fi
echo "OK /api/auth/login → HTTP 200 (admin demo)"

# Wrong prefix must NOT look like a successful API login (catches nginx misroute regressions)
bad_code="$(curl -sS -o /tmp/bb-smoke-login-bad -w '%{http_code}' --connect-timeout 10 --max-time 30 \
  -X POST "${BASE}/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"admin"}' || true)"
if [[ "${bad_code}" == "200" ]] && grep -q 'access_token' /tmp/bb-smoke-login-bad 2>/dev/null; then
  echo "FAIL: /auth/login (no /api) unexpectedly returns API token — nginx routing drift?" >&2
  exit 1
fi
echo "OK /auth/login without /api is not API login (HTTP ${bad_code})"

ENV_FILE="${BUDGETBASKET_ENV_FILE:-/etc/budgetbasket/.env}"
bash "${ROOT}/deploy/vps/verify-env.sh" "${ENV_FILE}"

if [[ -d "${ROOT}/.git" ]]; then
  echo "DEPLOYED_SHA=$(git rev-parse HEAD)"
fi

echo "POST_DEPLOY_VERIFY_PASS"
