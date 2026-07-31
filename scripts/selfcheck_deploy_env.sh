#!/usr/bin/env bash
# Self-check deployment env contract without network or Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cat >"${tmp}" <<'EOF'
VITE_API_URL="/api"
ALLOWED_UPLOAD_MIME_TYPES=application/pdf,application/zip
FILE_GUARD_ALLOWED_EXTENSIONS=.pdf,.zip
FILE_GUARD_ALLOWED_MIME_TYPES=application/pdf,application/zip
EOF
bash "${ROOT}/deploy/vps/verify-env.sh" "${tmp}" >/dev/null \
  || fail "valid production env rejected"

cat >"${tmp}" <<'EOF'
VITE_API_URL=/api
ALLOWED_UPLOAD_MIME_TYPES=application/pdf, application/zip
FILE_GUARD_ALLOWED_EXTENSIONS=.pdf, .zip
FILE_GUARD_ALLOWED_MIME_TYPES=application/pdf, application/zip
EOF
bash "${ROOT}/deploy/vps/verify-env.sh" "${tmp}" >/dev/null \
  || fail "CSV with spaces after commas rejected"

printf '%s\n' \
  'VITE_API_URL=/api' \
  'ALLOWED_UPLOAD_MIME_TYPES=application/pdf' \
  'FILE_GUARD_ALLOWED_EXTENSIONS=.pdf' \
  'FILE_GUARD_ALLOWED_MIME_TYPES=application/pdf' >"${tmp}"
if bash "${ROOT}/deploy/vps/verify-env.sh" "${tmp}" >/dev/null 2>&1; then
  fail "missing ZIP allowlist accepted"
fi

printf '%s\n' \
  'VITE_API_URL=https://budgetbasket.acom-offer-desk.ru' \
  'ALLOWED_UPLOAD_MIME_TYPES=application/zip' \
  'FILE_GUARD_ALLOWED_EXTENSIONS=.zip' \
  'FILE_GUARD_ALLOWED_MIME_TYPES=application/zip' >"${tmp}"
if bash "${ROOT}/deploy/vps/verify-env.sh" "${tmp}" >/dev/null 2>&1; then
  fail "wrong VITE_API_URL accepted"
fi

echo "SELFCHECK_DEPLOY_ENV_PASS"
