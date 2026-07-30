#!/usr/bin/env bash
# Update running BudgetBasket stack on VPS to the current git checkout.
# Does NOT wipe Postgres/SeaweedFS volumes. Does NOT restore dumps.
# Expects: already at target SHA (git reset --hard done by caller).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

ENV_FILE="${BUDGETBASKET_ENV_FILE:-/etc/budgetbasket/.env}"
if [[ ! -f "${ENV_FILE}" ]]; then
  # fallback used on some hosts
  if [[ -f "${ROOT}/.env" ]]; then
    ENV_FILE="${ROOT}/.env"
  else
    echo "FAIL: env file not found (tried /etc/budgetbasket/.env and ${ROOT}/.env)" >&2
    exit 1
  fi
fi

echo "Using ENV_FILE=${ENV_FILE}"
echo "TARGET_SHA=$(git rev-parse HEAD)"

# Soft guard: warn if .env.example has keys missing from live env (ZIP allowlist class of bugs)
if [[ -f "${ROOT}/.env.example" ]]; then
  missing=0
  while IFS= read -r line; do
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[[:space:]]/}" ]] && continue
    key="${line%%=*}"
    key="${key%%[[:space:]]*}"
    [[ -z "${key}" ]] && continue
    if ! grep -qE "^[[:space:]]*${key}=" "${ENV_FILE}"; then
      echo "WARN: key from .env.example missing in live env: ${key}" >&2
      missing=1
    fi
  done < "${ROOT}/.env.example"
  if [[ "${missing}" -eq 1 ]]; then
    echo "WARN: live env may be stale vs .env.example — review allowlists before relying on new upload types" >&2
  fi
fi

docker compose --env-file "${ENV_FILE}" up -d --build

echo "REMOTE_UPDATE_DONE SHA=$(git rev-parse HEAD)"
