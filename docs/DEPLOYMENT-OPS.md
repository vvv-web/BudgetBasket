# BudgetBasket: fork, upstream, deploy

## Кто что меняет

- `alexonderia/BudgetBasket` — исходный код Саши.
- `vvv-web/BudgetBasket` — fork для операционных файлов и TEST-деплоя.
- `upstream` — только чтение. Изменения Саши приходят через sync PR.

## Синхронизация

`.github/workflows/sync-upstream.yml` по расписанию:

1. Забирает `upstream/main`.
2. Собирает merge в ветке `automation/upstream-sync`.
3. При конфликте останавливается и не меняет `main`.
4. Создаёт или обновляет PR в `main`.
5. Запускает `CI` для точного SHA ветки.

`main` не меняется автоматически. PR можно вливать только после зелёного CI.

## Деплой

`.github/workflows/deploy.yml` запускается только вручную через `workflow_dispatch`.

Перед SSH-выкатом workflow проверяет:

- успешный `CI` именно для SHA, который выбран к выкладке;
- `origin` на VPS указывает на `vvv-web/BudgetBasket`;
- checkout VPS чистый;
- SHA существует в checkout.

`deploy/vps/verify-env.sh` проверяет безопасные production-настройки:

- `VITE_API_URL=/api`;
- ZIP разрешён в backend и `file_guard`.

`deploy/vps/production-runtime.patch` хранит live-hardening для CORS и Vite host.
CI проверяет, что patch применяется к текущему SHA. Во время build patch временно
применяется, после build автоматически снимается. Исходники Саши в fork не переписываются.

После `docker compose up` `scripts/post-deploy-verify.sh` проверяет health, DB health,
UI, `POST /api/auth/login`, неправильный путь `/auth/login` и тот же env-контракт.

Грязный checkout намеренно блокирует деплой. Ручные файлы нельзя затирать автоматически:
сначала сохранить изменения и отдельно подтвердить очистку VPS.
