#!/usr/bin/env bash
# Update the BudgetBasket k3s stack on VPS to a given git SHA (k3s-era deploy).
# Replaces deploy/vps/remote-update.sh (docker compose) — compose stack retired 2026-09-15 (MBO №2 Ф5).
# Does NOT wipe Postgres/SeaweedFS PVCs. Does NOT restore dumps.
# Usage: remote-update-k8s.sh <git-sha>
#
# Registry: there is none — images are built on the VPS and imported into k3s containerd
# (docker save | k3s ctr images import). Because imagePullPolicy is IfNotPresent, a reused
# tag would NOT be picked up: every deploy builds with tag :sha-<short> and rolls via set image.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <git-sha>" >&2
  exit 1
fi
SHA="$1"
SHORT="${SHA:0:7}"
NS="budgetbasket"
TAG="sha-${SHORT}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

# --- guards (parity with deploy/vps/remote-update.sh) ---
ORIGIN_URL="$(git config --get remote.origin.url || true)"
case "${ORIGIN_URL}" in
  *vvv-web/BudgetBasket*) : ;;
  *) echo "FAIL: unexpected origin URL: ${ORIGIN_URL} (expected vvv-web/BudgetBasket)" >&2; exit 1 ;;
esac

if [[ -n "$(git status --porcelain)" ]]; then
  echo "FAIL: dirty checkout at ${ROOT} — refusing to deploy" >&2
  exit 1
fi

ENV_FILE="${BUDGETBASKET_ENV_FILE:-/etc/budgetbasket/.env}"
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ROOT}/.env" ]]; then
    ENV_FILE="${ROOT}/.env"
  else
    echo "FAIL: env file not found (tried /etc/budgetbasket/.env and ${ROOT}/.env)" >&2
    exit 1
  fi
fi

echo "Using ENV_FILE=${ENV_FILE}"

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

# Production invariants incl. VITE_API_URL=/api hard guard
bash "${ROOT}/deploy/vps/verify-env.sh" "${ENV_FILE}"

# --- checkout target SHA ---
git fetch origin main
git checkout --detach "${SHA}" --quiet
git reset --hard "${SHA}" --quiet
echo "TARGET_SHA=$(git rev-parse HEAD)"

# --- build images on VPS ---
# production-runtime.patch больше НЕ применяется: CORS-домен внесён в backend/app/factory.py
# (коммит в репо), остальные ханки патча были compose/dev-server эпохи и k8s-сборке не нужны.

BB_BACKEND="bb-backend:${TAG}"
BB_FRONTEND="bb-frontend:${TAG}"
BB_FILE_GUARD="bb-file-guard:${TAG}"

docker build -t "${BB_BACKEND}" backend
docker build -f frontend/Dockerfile.prod --build-arg VITE_API_URL=/api -t "${BB_FRONTEND}" frontend
# file_guard: контекст — корень репо (Dockerfile COPY file_guard/...), как в docker-compose.yml.
docker build -f file_guard/Dockerfile -t "${BB_FILE_GUARD}" .

# --- import into k3s containerd (no registry; imagePullPolicy IfNotPresent) ---
for img in "${BB_BACKEND}" "${BB_FRONTEND}" "${BB_FILE_GUARD}"; do
  docker save "${img}" | k3s ctr images import -
  echo "OK imported into containerd: ${img}"
done

# --- secrets + manifests ---
bash "${ROOT}/deploy/k8s/budgetbasket/create-secrets.sh" "${ENV_FILE}"
kubectl apply -k "${ROOT}/deploy/k8s/budgetbasket/"
kubectl apply -f "${ROOT}/deploy/k8s/bb-frontend/"

# --- roll deployments onto the new tag ---
kubectl -n "${NS}" set image deployment/bb-backend  "backend=${BB_BACKEND}"
kubectl -n "${NS}" set image deployment/file-guard  "file-guard=${BB_FILE_GUARD}"
kubectl -n "${NS}" set image deployment/bb-frontend "frontend=${BB_FRONTEND}"
for d in bb-backend file-guard bb-frontend; do
  kubectl -n "${NS}" rollout status "deployment/${d}" --timeout=5m
  echo "OK rollout: ${d} @ ${TAG}"
done

echo "REMOTE_UPDATE_DONE SHA=$(git rev-parse HEAD) TAG=${TAG}"
