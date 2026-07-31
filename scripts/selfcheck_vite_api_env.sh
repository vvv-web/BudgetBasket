#!/usr/bin/env bash
# Self-check: VITE_API_URL gate used by remote-update / post-deploy (incident 2026-07-31).
# No network. Exit 0 only if assertions pass.
set -euo pipefail

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

read_vite() {
  grep -E '^[[:space:]]*VITE_API_URL=' "$1" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true
}

printf 'VITE_API_URL=/api\n' >"${tmp}"
[[ "$(read_vite "${tmp}")" == "/api" ]] || fail "expected /api"

printf 'VITE_API_URL=https://budgetbasket.acom-offer-desk.ru\n' >"${tmp}"
[[ "$(read_vite "${tmp}")" != "/api" ]] || fail "full URL must not equal /api"

printf 'VITE_API_URL="/api"\n' >"${tmp}"
[[ "$(read_vite "${tmp}")" == "/api" ]] || fail "quoted /api"

echo "SELFCHECK_VITE_API_ENV_PASS"
