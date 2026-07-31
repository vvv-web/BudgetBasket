#!/usr/bin/env bash
# Verify non-secret production settings before recreating the stack.
set -euo pipefail

ENV_FILE="${1:-${BUDGETBASKET_ENV_FILE:-/etc/budgetbasket/.env}}"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "FAIL: env file is not readable: ${ENV_FILE}" >&2
  exit 1
fi

env_value() {
  local key="$1"
  local value

  value="$(
    grep -E "^[[:space:]]*${key}=" "${ENV_FILE}" \
      | tail -1 \
      | cut -d= -f2- \
      || true
  )"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value}"
}

require_value() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(env_value "${key}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "FAIL: ${key} must be ${expected}" >&2
    exit 1
  fi
  echo "OK ${key}"
}

require_contains() {
  local key="$1"
  local required="$2"
  local actual
  # CSV may contain spaces after commas; ignore whitespace for membership.
  actual="$(env_value "${key}" | tr -d '[:space:]')"
  if [[ ",${actual}," != *",${required},"* ]]; then
    echo "FAIL: ${key} must contain ${required}" >&2
    exit 1
  fi
  echo "OK ${key} contains ${required}"
}

# Production nginx routes browser API calls under /api.
require_value VITE_API_URL /api

# ZIP support is part of Sasha's current application contract.
require_contains ALLOWED_UPLOAD_MIME_TYPES application/zip
require_contains FILE_GUARD_ALLOWED_EXTENSIONS .zip
require_contains FILE_GUARD_ALLOWED_MIME_TYPES application/zip

echo "DEPLOY_ENV_CONTRACT_PASS"
