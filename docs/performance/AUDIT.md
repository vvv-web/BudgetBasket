# Аудит производительности BudgetBasket

Дата измерений: 9–11 сентября 2026 года. Изменения выполнены без изменения бизнес-схемы данных и без Git-коммитов.

## Итог по приоритетам

| Приоритет | Компонент | Проблема | Причина | Исправление | Измеренный эффект |
| --- | --- | --- | --- | --- | --- |
| P0 | Реестр | Начальная загрузка передавала все детальные строки | Один endpoint строил полные комментарии, решения, файлы и месячные планы до выделения страницы | Добавлен типизированный query API: `summary`, `groups`, `rows`, `facets`, `selection`; frontend переведён на него | На 20 000 строк: 52,18 МБ → 37,6 КБ; p50 4,25 → 1,86 с |
| P0 | Страницы реестра | `/approval-register/rows` читал весь реестр ради 50 строк | Фильтрация и пагинация выполнялись после загрузки таблиц | SQL выбирает устойчиво отсортированные ID страницы, затем пакетно загружает полный workflow-контекст только нужных заявок/позиций | Scope одной заявки: p50 1,74 с → 50 мс; получено 40 627 → 283 записей |
| P0 | Согласование ЗГД | Массовое решение создавало отдельный HTTP-запрос для каждой выбранной строки, а каждый запрос повторно синхронизировал все шаги | Frontend разворачивал bulk-выбор в сотни одиночных position actions; `_sync_step_statuses` повторно сканировал строки позиций | Добавлен единый `POST /approval-position-lines/approve/bulk`; вся операция выполняется в одной транзакции, с одним audit event и одной синхронизацией. Контекст шагов и справочники строятся один раз на пакет | На текущих 49 позициях/365 строках: до 365 HTTP-запросов → 1; сервисный слой 306 мс, 161 SQL-запрос, транзакция полностью откачена после замера |
| P0 | Область группового действия | Перед мутацией реестр полностью вычислялся ради списка ID | `selection` проходил через полную Python workflow-сборку | Простые selection-запросы выполняются адресным SQL, затем права и actionability перепроверяются на ограниченном наборе строк | На текущих данных область из 341 строки: 8 мс и 4 SQL-запроса |
| P0 | Доступ к БД из async | Синхронные транзакции блокировали event loop | Сервисный и repository-код вызывался прямо из `async` handlers | Транзакционные операции целиком выполняются через существующий thread pool; события отправляются после успеха | Статически устранены прямые sync-вызовы в изменённых async handlers; workflow-тесты проходят |
| P0 | Файлы | Обработанный `file_guard`-ответ мог полностью находиться в памяти | Backend получал всё тело перед проверкой и S3 | Чтение по 64 КБ в `SpooledTemporaryFile`, жёсткий лимит, SHA-256 до S3, закрытие stream во всех ветках | 18 тестов `file_guard` и тесты ошибок/закрытия stream проходят |
| P1 | Заявки | Список повторно обрабатывал строки всех заявок | Полные таблицы и Python-агрегация | SQL-фильтры, пакетные агрегаты, совместимый numbered page mode | Непагинированный p50 1,69 → 0,89 с; page=50 — 134 мс |
| P1 | История | История соединяла и сортировала журналы в памяти | Полное чтение `req_logs` и `cfo_position_logs` | SQL `UNION ALL`, курсор `(created_at, source:id)`, page size 50 и адресное обогащение | На 20 000 строк page p50 118 мс, 416 полученных записей; одинаковое время не создаёт дублей |
| P1 | Чаты | Список чатов строил историю каждого чата | Последнее сообщение и unread считались после загрузки сообщений | Коррелированные latest/unread запросы, пакет сообщений, cursor pages с reply preview | В тестовом сценарии получено 9 → 2 записей при неизменном пустом ответе; paging/replies/unread покрыты тестами |
| P1 | Уведомления и права | Использовались полные таблицы | Фильтрация происходила в сервисах | Адресные repository-запросы и SQL-области доступа | Уведомления: 9 → 2 полученных записей; права проверяются повторно при действиях |
| P1 | Групповые действия и экспорт | Клиент мог передать только видимую страницу | Выборка считалась состоянием UI | Backend заново получает `selection` по полному фильтру и group scope и перепроверяет права перед записью | API-тесты подтверждают действия только по серверной отфильтрованной области |
| P1 | DOM реестра | Раскрытые ветви могли создать тысячи строк DOM | Обычный рекурсивный render дерева | `@tanstack/react-virtual`, загрузка ветвей и страниц по мере видимости, sticky header и клавиатурный focus | На наборе 20 000 строк: 3 строки сначала, 24 после раскрытия, 27 после прокрутки |
| P2 | Production frontend | Vite dev server был единственным Compose-вариантом | Не было production image и HTTP cache policy | Multi-stage Vite/nginx Compose-конфигурация | HTML: `no-cache`; hashed asset: `max-age=31536000, immutable`; API proxy и SPA fallback проверены |

## Что измерено, а что выведено из кода

Измерены HTTP p50/p95, SQL count/time, число строк DBAPI, размер JSON и локально рассчитанный gzip, время JSON-сериализации, pool checkout, транзакции и process RSS high-water mark. Для браузера измерены navigation time, запросы, объём JS, long tasks, число DOM-строк и клавиатурное перемещение. SQL-планы получены через `EXPLAIN (ANALYZE, BUFFERS)` на отдельной базе.

Статическим анализом установлены полные чтения таблиц, прямые sync-вызовы из async handlers и прежнее чтение целого ответа `file_guard`. Вывод о том, что оставшаяся задержка `summary` в основном относится к Python workflow-вычислениям, основан на разнице HTTP p50 1,86–2,17 с и SQL p50 77 мс в изолированном процессе. Это обоснованный вывод, а не отдельный CPU-profile.

## Карта endpoint-сценариев

| Сценарий | Основные интерфейсы | Проверка |
| --- | --- | --- |
| Авторизация | `/auth/login`, `/auth/me` | адресные user/profile/responsible queries, смена пользователя в API-тестах |
| Реестр | legacy `/approval-register`, `/rows`; новый `POST /approval-register/query` | contract parity, summary/groups/rows/facets/selection, browser profile |
| Экспорт и массовые действия | `POST /approval-register/export`, group decision/workflow endpoints | полная server-side selection и повторная проверка прав |
| Заявки и строки | `/requests`, `/requests/{id}`, `/requests/{id}/items` | legacy-ответ сохранён; optional numbered pages |
| Согласование | `/steps`, `/approval-route`, `/cfo-positions`, approve/return/freeze/fix endpoints | полный workflow-suite, включая возвраты и повторное согласование |
| Dashboard | `/dashboard`, `/dashboard/income`, article/table endpoints | HTTP benchmark и regression tests |
| Справочники | `/catalog/dds`, `/catalog/invests`, import/template | существующие CRUD/Excel-интерфейсы сохранены |
| История | `/requests/{id}/logs`, `/approval-register/history`, position logs | cursor `(time, unique ID)`, равные timestamps, пустая/последняя страницы |
| Чаты | `/chats`, request/position chat, messages, read markers, WebSocket | latest/unread без истории; paging, replies, read markers, dedupe |
| Уведомления | `/notifications`, read/read-all | optional numbered page и адресные запросы |
| Файлы | item upload/list/delete, `/files/{id}/download` | bounded guard stream, SHA-256, S3 after validation, streaming close |

## Методика

`scripts.performance_audit` создаёт или повторно использует только базы `budgetbasket_perf_100`, `budgetbasket_perf_1000`, `budgetbasket_perf_20000`, применяет Alembic, seed и синтетические строки с годами, журналами, позициями и 12 месячными планами. Рабочая база `budgetbasket` не меняется. Ролевые, статусные и маршрутные варианты проверены отдельно на текущем 497-строчном наборе contract-скриптом и полным workflow test suite; безопасность вложений проверена отдельным `file_guard` suite.

Для каждого HTTP-сценария выполнялся прогрев, затем 30 запросов при concurrency 1 и 10. Каждый размер запускался в отдельном Uvicorn-процессе. Поэтому RSS сравнивается по отдельным процессам; значение после тяжёлого legacy-запроса нельзя приписывать последующему endpoint.

Сырые результаты: `before.jsonl`, `after-final.jsonl`, `after-final2.jsonl`, `summary-isolated.jsonl`, `explain-final.jsonl`, `browser-final.json` и `browser-after-zgd.json` в этой директории.

## Результаты HTTP

Значения ниже — p50 при одном одновременном пользователе. `page` — новый global page из 50 строк.

| Строк | Старый полный register, мс | Новый summary, мс | Новая page, мс | Старый JSON | Summary JSON | Page JSON |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 50,73 | 40,57 | 36,71 | 275 532 Б | 14 067 Б | 130 234 Б |
| 1 000 | 251,72 | 102,01 | 49,78 | 2 620 672 Б | 15 238 Б | 130 345 Б |
| 20 000 | 4 248,20 | 1 857,48 | 89,54 | 52 184 537 Б | 37 586 Б | 130 536 Б |

На 20 000 строк initial summary уменьшил несжатый payload на 99,93%, gzip — с 468 145 до 1 719 байт (−99,63%), p50 — на 56,3%. Сериализация финального полного legacy-ответа занимала p50 415,5 мс; summary — 0,29 мс.

| Сценарий, 20 000 | p50 / p95, concurrency 1 | p50 / p95, concurrency 10 | SQL count | Получено записей | JSON |
| --- | ---: | ---: | ---: | ---: | ---: |
| Старый полный register, baseline | 4,25 / 7,78 с | 78,30 / 98,68 с | 14 | 40 627 | 52,18 МБ |
| Новый summary, финальный код | 1,86 / 2,19 с | 25,31 / 28,12 с | 15 | 40 625 | 37,6 КБ |
| Новый scoped page 50 | 50 / 100 мс | 446 / 511 мс | 19 | 283 | 130,2 КБ |
| Новый global page 50 | 90 / 144 мс | 617 / 1 008 мс | 19 | 283 | 130,5 КБ |
| Requests page 50 | 134 / 273 мс | 1,51 / 2,00 с | 10 | 5 165 | 37,5 КБ |
| History page 50 | 118 / 193 мс | 440 / 628 мс | 13 | 416 | 45,6 КБ |

Изолированный RSS summary составил 216 МБ при concurrency 1 и 847 МБ при concurrency 10. Baseline полного register — 437 МБ и 1 898 МБ соответственно: снижение high-water mark на 50,5% и 55,4%. Pool checkout p50 у summary был 0,12/0,22 мс; p95 при concurrency 10 — 48,9 мс. Оснований увеличивать pool, workers или timeout нет.

Совместимый полный `GET /approval-register` оставлен для внешних клиентов. На 20 000 строк он по-прежнему создаёт 52-МБ JSON и не должен использоваться новым UI; финальный контроль дал p50 4,97 с. Его удаление было бы несовместимым изменением API.

## PostgreSQL и индексы

| SELECT на 20 000 строк | План | Фактическое время | Буферы | Вывод |
| --- | --- | ---: | ---: | --- |
| Все `req_items` | Seq Scan, 20 000 rows | 10,57 мс | 385 reads | Ожидаемо для полной таблицы; исключено из pages |
| `req_items` одной заявки | Bitmap Heap/`idx_req_items_request_id`, 100 rows | 0,44 мс | 2 hits + 2 reads | Существующий индекс достаточен |
| Workflow request/position scope | Bitmap Heap, 100 rows | 0,56 мс | 4 hits + 2 reads | Пакетный контекст ограничен |
| Все `req_logs` | Seq Scan, 20 200 rows | 10,75 мс | 546 reads | Исключено из page/history paths |
| Логи одной заявки | Bitmap Heap/`idx_req_logs_req_id_created_at`, 101 rows | 0,34 мс | 3 hits + 2 reads | Существующий индекс достаточен |
| Месячные планы 50 строк | Bitmap Heap/составной PK | 0,53 мс | 164 hits | Дополнительный индекс дублировал бы PK |
| Последние 51 событие | Limit + `idx_req_logs_req_id_created_at` | 0,20 мс | 15 hits | Cursor page использует индекс |

Новые индексы не добавлялись. Репрезентативные планы используют существующие `idx_req_items_request_id`, `idx_req_items_cfo_position_id`, `idx_req_logs_req_id_created_at`, `idx_chat_messages_chat_id_created_at` и PK `(req_item_id, month)`. Поэтому стоимость дополнительной записи и место нового индекса не оправданы; Alembic, metadata и `db/init.sql` не менялись.

## Frontend

Реестр получает summary и предусмотренные раскрытые уровни, затем загружает дочерние группы и страницы по 50 строк. React Query использует общие ключи, AbortSignal и адресную инвалидацию после мутаций/WebSocket-событий. Column filters, facets и sort передаются серверу. Selection для экспорта и групповых действий пересчитывается backend по полной области. Массовое согласование строк ЗГД группирует строки по позиции и отправляет один пакет вместо отдельного HTTP-запроса на строку.

Повторный сервисный замер после исправления критического пути: на текущих данных summary — 149 мс, analytics filters — 15 мс; на изолированных 20 000 строках summary — 1,374 с, analytics filters — 40 мс, простая selection — 4 мс. Ранее analytics filters повторно выполнял почти полную сборку реестра параллельно с summary.

В повторном Playwright-профиле на 20 000 строк после устранения дублирующего расчёта analytics initial navigation заняла 3,38 с вместо 4,68 с (−27,8%), повторная — 3,34 с вместо 4,62 с (−27,7%). Начальный DOM содержал 3 строки, раскрытый — 24, после прокрутки — 27; ArrowDown переместил focus; browser errors отсутствуют. Загружено 1 123 710 байт JS после декодирования, 423 607 байт transfer. Preview-библиотеки DOCX/PDF/Excel в сценарии без предпросмотра не загружались. Зафиксировано 11 long tasks суммарно на 1 283 мс, максимум 368 мс; ранее было 12 задач, 2 561 мс суммарно и максимум 902 мс.

## Совместимость и проверки

`register_contract` сравнил текущий код с `request_service.py` из Git HEAD на неизменённой PostgreSQL: до двух пользователей каждой роли admin/employee/economist/approver/zgd, 7 наборов фильтров, exact legacy payload, aggregates summary и первая/последняя page. Все 56 сочетаний прошли. Отдельные тесты проверяют cancelled/deleted, income/expense, returns/revisions, frozen/fixed, одинаковые времена событий, пустые и последние страницы, replies/read markers и отсутствие дублей.

Проверки финального дерева:

- backend в собранном контейнере: 131 passed, 2 skipped; отдельный PostgreSQL-набор с явной `PERFORMANCE_DATABASE_URL`: 2 passed;
- frontend: 95 passed; TypeScript и Vite production build проходят;
- `file_guard`: 18 passed;
- `python -m compileall app` проходит;
- Alembic: `20260902_0028 (head)`;
- Compose: PostgreSQL ready, `file_guard` ready, `/health` и `/health/db` возвращают `ok`;
- production nginx: SPA, `/api/health`, cache headers и gzip-конфигурация проверены.

## Оставшиеся ограничения

Summary обязан сохранить производные статусы, порядок решений и правила повторного согласования. В текущей реализации он всё ещё получает около 40,6 тыс. минимальных item/log records на наборе 20 000 и выполняет workflow-агрегацию в Python. После устранения повторного analytics-расчёта изолированное время самого summary составляет 1,374 с; дальнейший безопасный этап требует отдельного профиля функций workflow и доказательства эквивалентности SQL/precomputed агрегатов.

Синтетический benchmark предназначен для сравнения объёма работы одного кода и не является прогнозом production throughput. Browser profile выполнялся headless Chromium на локальном Docker Desktop. Vite по-прежнему сообщает о крупных общих chunks; тяжёлые preview-модули уже lazy, дальнейшее ручное разбиение следует делать только после route-level bundle profile.
