#!/usr/bin/env bash
# create-secrets.sh — создаёт/обновляет Secret bb-env в namespace budgetbasket из /opt/budgetbasket/.env.
# Значения секретов НЕ печатаются в лог и не коммитятся; файл-вход читается только на VPS.
# Что делает:
#   1) фильтрует .env: отбрасывает хостовые порты, pgadmin, frontend/dev-переменные, имена контейнеров и *_IMAGE;
#   2) правит FILE_GUARD_URL: в compose хост file_guard (подчёркивание недопустимо в DNS-именах k8s) → file-guard;
#   3) идемпотентно применяет секрет: kubectl create secret --dry-run=client -o yaml | kubectl apply -f -.
# Прочие хосты совпадают с именами сервисов k8s: postgres:5432 (DATABASE_URL), seaweedfs:8333 (S3_ENDPOINT).
# Запуск (на acom-vps):  bash deploy/k8s/budgetbasket/create-secrets.sh [путь-к-.env]
set -euo pipefail

NS="budgetbasket"
ENV_FILE="${1:-/opt/budgetbasket/.env}"
TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}"' EXIT
chmod 600 "${TMP_FILE}"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "не читается env-файл: ${ENV_FILE}" >&2
  exit 1
fi

# 1) только строки VAR=value; без хостовых портов, pgadmin, frontend, имён контейнеров и образов
grep -E '^[A-Z][A-Z0-9_]*=' "${ENV_FILE}" \
  | grep -vE '^([A-Z0-9_]+_HOST_PORT|PGADMIN_[A-Z0-9_]*|FRONTEND_[A-Z0-9_]*|VITE_[A-Z0-9_]*|[A-Z0-9_]+CONTAINER_NAME|[A-Z0-9_]+_IMAGE)=' \
  | sed -E 's#^FILE_GUARD_URL=.*#FILE_GUARD_URL=http://file-guard:8080#' \
  > "${TMP_FILE}"

# 2) идемпотентная запись секрета (bb-env)
kubectl -n "${NS}" create secret generic bb-env \
  --from-env-file="${TMP_FILE}" \
  --dry-run=client -o yaml \
  | kubectl apply -f -

echo "Готово: secret/${NS}/bb-env ($(wc -l < "${TMP_FILE}") переменных)"
