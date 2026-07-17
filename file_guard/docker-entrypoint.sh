#!/bin/sh
# Важно: у файла должны быть LF-переносы, потому что скрипт исполняется прямо в Linux-контейнере.
set -eu

CLAMD_PID=""
UVICORN_PID=""

stop_process() {
  pid="$1"
  if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
  fi
}

cleanup() {
  stop_process "${UVICORN_PID}"
  stop_process "${CLAMD_PID}"
}

trap cleanup INT TERM

echo "[file_guard] Подготавливаем каталоги ClamAV и права доступа"
mkdir -p /run/clamav /var/lib/clamav /var/log/clamav
chown -R clamav:clamav /run/clamav /var/lib/clamav /var/log/clamav

if [ "${FILE_GUARD_ANTIVIRUS_ENABLED:-true}" = "true" ]; then
  if [ "${FILE_GUARD_CLAMAV_UPDATE_ON_START:-true}" = "true" ]; then
    echo "[file_guard] Обновляем антивирусные базы ClamAV перед запуском"
    freshclam_attempts="${FILE_GUARD_FRESHCLAM_ATTEMPTS:-3}"
    freshclam_ok=0
    i=1
    while [ "${i}" -le "${freshclam_attempts}" ]; do
      if freshclam --config-file=/etc/clamav/freshclam.conf; then
        freshclam_ok=1
        break
      fi
      echo "[file_guard] freshclam: попытка ${i}/${freshclam_attempts} не удалась, повтор через 5с"
      sleep 5
      i=$((i + 1))
    done
    # Не валим старт: clamd может обновить базы позже. Но readiness-проба
    # держит /ready в 503, пока clamd реально не готов сканировать.
    if [ "${freshclam_ok}" != "1" ]; then
      echo "[file_guard] ВНИМАНИЕ: не удалось обновить базы ClamAV при старте; clamd попробует позже"
    fi
  fi

  echo "[file_guard] Запускаем локальный процесс clamd"
  clamd --foreground --config-file=/etc/clamav/clamd.conf &
  CLAMD_PID="$!"
else
  echo "[file_guard] Антивирусная проверка отключена настройкой FILE_GUARD_ANTIVIRUS_ENABLED=false"
fi

echo "[file_guard] Запускаем FastAPI-сервис проверки файлов"
uvicorn app.main:app --host 0.0.0.0 --port "${FILE_GUARD_PORT:-8080}" &
UVICORN_PID="$!"

exit_code=0
while kill -0 "${UVICORN_PID}" 2>/dev/null; do
  if [ -n "${CLAMD_PID}" ] && ! kill -0 "${CLAMD_PID}" 2>/dev/null; then
    echo "[file_guard] Процесс clamd завершился; останавливаем uvicorn"
    cleanup
    exit 1
  fi
  sleep 1
done

wait "${UVICORN_PID}" 2>/dev/null || exit_code=$?
cleanup
exit "${exit_code}"
