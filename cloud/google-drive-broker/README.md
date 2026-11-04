# Google Drive OAuth и координатор синхронизации ZeTer OS

Отдельный Cloudflare Worker с D1 хранит зашифрованные web OAuth refresh tokens, opaque сессии и указатель на согласованный снимок файлов в Google Drive. Файлы, manifest и прочее содержимое передаются между Windows/PWA и Google Drive напрямую. Сервис не принимает содержимое пользовательских файлов. Для публичного приложения используется Google OAuth Web application со scope `https://www.googleapis.com/auth/drive.file`.

## Информационные страницы

`GET /` и `GET /privacy` без query доступны без OAuth secrets/D1. Главная описывает сервис и ведёт в ZeTer OS; страница конфиденциальности описывает локальные данные, прямую передачу файлов в Drive, серверные сессии/метаданные, хранение web refresh token, временную передачу Windows code/PKCE/refresh, локальный Windows DPAPI, отключение и запрос удаления. Контакт поддержки — `zeter11@gmail.com`. Страницы не исполняют скрипты, не загружают ресурсы и запрещают формы/встраивание через CSP. Это публичные URL для Google Branding home/privacy; их доступность не подтверждает готовность OAuth API.

## Контракт браузера

1. Сгенерировать 32 случайных байта, кодировать base64url без padding (`nonce`, 43 символа), открыть popup `{PUBLIC_URL}/oauth/start?origin=<encodeURIComponent(location.origin)>&nonce=<nonce>`. Начальный `origin` должен точно входить в allowlist.
2. Принять message только при одновременном совпадении `event.origin === PUBLIC_URL`, `event.source === popup`, `type === 'zeter-google-drive-auth'` и ожидаемого `nonce`. Message содержит `{type,nonce,sessionHandle}`. Access/refresh token в message не передаётся.
3. Сохранить opaque `sessionHandle` (43 символа) в отдельной IndexedDB текущего браузера. Не включать в экспорт, общие настройки или логи. При отправке `POST /token` установить `Authorization: Bearer <sessionHandle>`, `Content-Type: application/json`, body `{}`, `credentials: 'omit'`. Ответ `{accessToken,expiresAt}`, где `expiresAt` — Unix milliseconds. Access token держать только в памяти.
4. `POST /disconnect` с теми же headers/body отключает только эту браузерную сессию. После подтверждённого ответа `{ok:true}` удалить handle. Google revoke не вызывается: он может отключить другие клиенты того же OAuth-проекта.

`GET /health` возвращает только `{ok:true}`: это liveness, не подтверждение готовности secrets/D1/OAuth. Origin CORS разрешён только точно из allowlist; cookies не используются. Сессия действует максимум 90 дней без продления. OAuth state одноразовый, живёт 10 минут. При `401 reconnect_required` требуется новое подключение; `409 session_changed` означает конкурентное изменение или отключение, старый ответ нельзя применять автоматически. Остальные ошибки содержат только безопасный код в `{error}`.

## Windows и общий указатель файлов

Все три исходящих запроса к Google используют поддерживаемый Workers режим `redirect:manual` и отклоняют ответы 3xx. Режим `error` из браузерного Fetch в Workers не поддерживается. Безопасные диагностические коды различают `google_client_configuration` (подтверждённый отказ настройки клиента), `google_response_invalid` (неверный формат ответа) и `google_unavailable` (связь/временный отказ), без upstream-описаний и credentials. Только `401 reconnect_required` означает необходимость нового входа.

Windows сохраняет собственные Google OAuth tokens через DPAPI. Обмен кода и обновление выполняются через одобренный фиксированный `https://zeter-os-sync.zeter11.workers.dev/native/token`; изменение hostname в config не перенаправляет туда credentials. Desktop client secret находится только в Worker Secret `DESKTOP_CLIENT_SECRET`, отсутствует в Windows bundle/публичном config.

`POST /native/token` принимает только JSON ≤16 KiB, без Origin/query: `{grant_type:"authorization_code",code,code_verifier,redirect_uri}` либо `{grant_type:"refresh_token",refresh_token}`. Лишние поля запрещены. Redirect — только `http://127.0.0.1:<1..65535>/oauth2callback`, verifier — 43–128 символов PKCE, refresh token — до 8192 символов. Worker сам добавляет фиксированные Desktop client ID/secret и обращается только к Google token endpoint, без redirects, с общим timeout 10 секунд. В D1 записывается только keyed IP rate counter: 10 обменов на 10 минут, отдельный namespace от web OAuth start. Native code, verifier и refresh token не сохраняются, не логируются и не помещаются в URL. Ответ содержит только проверенные snake_case token поля, нормализованные `token_type:Bearer` и `scope:drive.file`; начальный grant требует refresh token, лишние scopes отклоняются. Только Google HTTP 400 `invalid_grant` даёт `401 reconnect_required`; остальные сбои, malformed responses и rate limit не меняют сохранённое Windows подключение и позволяют явный повтор. Native HTTP transport ограничен 15 секундами и не следует redirects.

Для создания сессии координатора Windows отправляет `POST /native/session`, JSON `{accessToken}` (≤4096 bytes) на настроенный HTTPS broker, без заголовка Origin. Worker сначала проверяет metadata фиксированным `POST https://oauth2.googleapis.com/tokeninfo` с Bearer header: `aud` и `azp` должны точно совпасть с настроенным `DESKTOP_CLIENT_ID`, scope должен содержать именно `https://www.googleapis.com/auth/drive.file`, `expires_in` должен быть положительным, `exp` — в будущем. Пропущенные или неверные metadata отклоняются до запроса identity/создания сессии. Token не включается в URL, query или body исходящего tokeninfo запроса. Затем фиксированный `GET https://www.googleapis.com/drive/v3/about?fields=user(permissionId)` подтверждает Drive identity. Worker не сохраняет исходный Google token и возвращает `{sessionHandle,accountKey,expiresAt}`. Native session не имеет refresh token; `/token` для неё запрещён. Native client хранит opaque handle отдельно от синхронизируемых файлов и не отправляет Origin на дальнейших broker-запросах. Web session, напротив, требует свой точный Origin на каждом запросе.

При web callback выполняется та же проверка Google Drive identity. `accountKey` — lowercase hex SHA-256 строки `zeter-drive-user-v1:<permissionId>`, поэтому одна Drive identity имеет один coordinator account для Web и Desktop OAuth clients. Клиент никогда не задаёт accountKey запросом.

`GET /sync/head` с Bearer handle, без body, возвращает `{accountKey,head:null,generation:0}` для нового аккаунта либо `{accountKey,head,generation}`. HEAD snapshot:

```json
{
  "generation": 1,
  "rootFolderId": "google-drive-folder-id",
  "snapshotId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "manifestFileId": "google-drive-manifest-id",
  "manifestSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "contentHash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "operationId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "parentGeneration": 0,
  "committedAt": 1793000000000
}
```

`POST /sync/commit`, Bearer handle и JSON ≤4096 bytes:

```json
{
  "expectedGeneration": 0,
  "operationId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "rootFolderId": "google-drive-folder-id",
  "candidate": {
    "snapshotId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "manifestFileId": "google-drive-manifest-id",
    "manifestSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "contentHash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }
}
```

`expectedGeneration` — safe integer от 0 до `Number.MAX_SAFE_INTEGER-1`; IDs Google — 1–200 символов `[A-Za-z0-9_-]`; snapshot/operation — 32 lowercase hex; hash — 64 lowercase hex. Лишние ключи запрещены. Ответ успешного commit: `{accountKey,head,generation}`. В одной D1 transaction выполняются generation CAS, проверка активной session через SQL EXISTS и запись idempotency receipt. Проигравший writer получает `409 {error:'sync-conflict',head,generation}` с актуальным указателем. Одинаковые operationId и payload возвращают исходный принятый head даже после следующих commit: это позволяет восстановиться после потери ответа. Изменённый payload с прежним operationId получает conflict. Для актуального состояния после старого receipt отдельно запросить `/sync/head`. Session disconnect удаляет только session; head и receipts сохраняются.

Клиенты сначала загружают неизменяемый snapshot/manifest в Drive и проверяют его содержимое, затем публикуют указатель через coordinator. Сам broker проверяет формат ссылки, identity и CAS; существование и семантику Google Drive manifest/файлов подтверждает клиент. После CAS клиент согласует видимую папку с принятым head; конфликт требует чтения актуального снимка и явного разрешения расхождений. Broker не осуществляет файловые merge/restore/mirror/delete и не выполняет автоматический last-writer overwrite.

## Подготовка и публикация

Действия ниже меняют облачный аккаунт; запускать после разрешения владельца. Никакие credentials в репозиторий не добавлять.

1. Создать новую D1 database. Выполнить `schema.sql` в выбранной D1. Схема создаёт собственные таблицы, включая сохранённые head/operation receipts и резервации. `CREATE TABLE IF NOT EXISTS` не является миграцией прежнего варианта sessions. Для существующей D1 используйте согласованные additive migrations ниже.
2. Создать Worker из `worker.mjs`; привязать именно эту D1 как `DB`. Для Wrangler скопировать `wrangler.example.jsonc` в локальный config и заменить только `database_id`/PUBLIC_URL. Placeholder config не является готовой публикацией.
3. Установить non-secret variables: `ALLOWED_ORIGINS=https://dkl.do.am` (несколько точных HTTPS origins разделять запятой), `PUBLIC_URL=https://<точное-имя-worker>.workers.dev` без trailing slash/path/query, `DESKTOP_CLIENT_ID=596333951366-plnunnogqvpcsc89th5v2chhd0qv8hv7.apps.googleusercontent.com` (разрешённый Google OAuth Desktop client). Смена origin/client требует нового явного разрешения, не добавлять `null`, wildcard или localhost. Без Desktop client ID native registration отказывает; web OAuth использует отдельный GOOGLE_CLIENT_ID.
4. Создать Google OAuth client типа **Web application**. Включить Google Drive API. В authorized redirect URIs добавить ровно `{PUBLIC_URL}/oauth/callback`; consent screen и доступ приложения подготовить для нужной аудитории. В режиме Testing Google может ограничивать срок refresh token; 90 дней здесь — верхняя граница брокера, не гарантия Google.
5. Добавить Worker **Secrets**, не обычные Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DESKTOP_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`. Desktop secret должен соответствовать ровно `DESKTOP_CLIENT_ID`; не заменять web credentials. Последний — криптографически случайные 32 байта в canonical base64url (43 символа без padding). Передавать секреты через защищённый UI/secret input, не command-line аргументы, stdout или git. Ключ нужен для расшифровки D1; его смена делает прежние подключения недоступными, поэтому сохранять recovery-копию в собственном password manager.
6. Оставить Workers observability/logging выключенными (`observability.enabled:false`), не включать Tail/Logpush/другой сбор request URLs: callback URL содержит OAuth code/state. Worker сам ничего не логирует. Не добавлять analytics/сторонние скрипты на callback.
7. Опубликовать в согласованный Worker target, задать публичный broker URL в frontend и Windows. Проверить реальный popup, первый grant, `/token`, reload браузера и повторное получение token, disconnect → отказ token → новое подключение. Windows и PWA одного Google аккаунта должны получить один accountKey и head; одновременные commit одной generation дают один успех и один conflict, повтор accepted operationId не создаёт новую generation. Отключение одного устройства не отключает второе и не удаляет head. Удалённый D1, реальные Google flow и файловое согласование отдельно подтвердить до заявления о готовности.

PKCE verifier и refresh token зашифрованы AES-256-GCM со случайным IV; AAD связывает версию, тип, hash и origin. D1 хранит hash session handle/state, не сами bearer secrets. SQL `DELETE … RETURNING` потребляет state атомарно; generation CAS и финальный primary-read блокируют поздний refresh после disconnect. Запросы идут через обычный D1 binding на primary; не заменять на replicated reads без повторной проверки этого свойства.

Ограничение OAuth start: 10 попыток на keyed IP hash за 10-минутное окно, максимум 500 живых pending-записей, expired rows удаляются при старте. Это ограничивает простое злоупотребление, но не защищает полностью от DDoS, распределённых IP и исчерпания квот бесплатного плана. Shared IP могут временно получить `429`. Повторных фоновых попыток Worker не делает. Секреты могут существовать открыто только в памяти Worker во время обмена; Cloudflare account и Google project остаются доверенными границами.

## Резервирование ID и миграция

`POST /sync/bootstrap` принимает Bearer handle и строго `{expectedGeneration,bootstrap}`. `bootstrap:null` только читает; предложение содержит четыре разных Drive ID `{rootFolderId,dataFolderId,historyFolderId,stagingFolderId}`. Ответ `{accountKey,head,generation,bootstrap}` возвращает один атомарно выбранный набор для аккаунта, включая конкурентный/повторный запрос. SQL повторно проверяет активную session, generation и root уже принятого head перед вставкой. Несовпадение поколения/root — `409 sync-conflict`; старые root и содержимое Drive этот API не изменяет. После disconnect резервации сохраняются.

`POST /sync/recreate` принимает Bearer handle и строго `{expectedGeneration,oldRootFolderId,bootstrap}`. Четыре ID новой структуры должны отличаться друг от друга и от старого root. Клиент вызывает endpoint после подтверждённого удаления собственного канонического root и durable сохранения нового плана полной загрузки. Worker не проверяет Drive и не получает файлы или Google credentials. Одна transaction сохраняет неизменяемый receipt в `sync_root_replacements` для `(account,oldRoot,generation)` и переключает `sync_bootstrap`; конкурентные запросы и повтор после потерянного ответа получают выигравший набор `{accountKey,head,generation,bootstrap}`. Аккаунт, session generation, активная session, текущее поколение и старый канонический root повторно проверяются внутри SQL. Несовпадение root/generation — `409 {error:'sync-conflict',head,generation}`. Старые head, operation/directory receipts сохраняются; поколение не откатывается.

До нового commit accepted head остаётся прежним. `/sync/bootstrap` допускает новую резервацию с отличающимся root только при точном совпадении структуры с receipt замены для root и generation прежнего head. Новый commit обязан совпадать с канонической резервацией, поэтому запоздалый commit старого root отклоняется; повтор уже принятого operationId по-прежнему возвращает прежний receipt. Замена initial reservation при `head:null` также поддерживается. Повторная замена pending root при ещё не опубликованном новом head отклоняется. Только клиент после ACK создаёт фиксированные Google-объекты и отправляет полный текущий локальный снимок.

Provider сначала использует принятый head/резервацию; при первичном discovery выбирает самый старый собственный `ZeTer OS` непосредственно в My Drive (createdTime, затем ID). Остальные корни сохраняются. Канонические дочерние папки — `data`, `.zeter-sync-history`, `.zeter-sync-staging` с kind `data/history/staging`. Несколько совпадений дочерней папки прекращают bootstrap до публикации резервации. Только после ACK резервации клиент создаёт папки с фиксированными ID; потеря ответа или смена uploadIntent не создают вторую структуру. Повтор проверяет namespace/kind/name/parent/pathKey/hash/size, а immutable файл также operationId и bytes; другой объект с тем же ID отклоняется.

`POST /sync/directory` принимает строго `{expectedGeneration,rootFolderId,parentId,name,pathKey,operationId,id}`: `id:null` читает; Drive ID предлагает резервацию. Принятый head должен совпадать по generation/root; ответ `{accountKey,id}` содержит один ID для `(account,root,pathKey)`, сохраняемый между поколениями. Для уже закреплённого пути смена parent/name — `409 directory-conflict`, устаревший head/root — `409 sync-conflict`. Клиент до предложения проверяет свою цепочку родителей и единственный существующий каталог; Worker не читает Drive. ID имеет 1–200 символов `[A-Za-z0-9_-]`, pathKey — 64 lowercase hex, operationId — 32 lowercase hex. Новые записи повторно проверяют session и head внутри SQL; отключение или смена поколения до вставки не публикуют запись.

Для существующей D1 сначала выполните [migrations/20261026_sync_reservations.sql](migrations/20261026_sync_reservations.sql), затем развёртывайте Worker с новыми endpoints. Миграция только добавляет `sync_bootstrap` и `directory_reservations` через `CREATE TABLE IF NOT EXISTS`; повтор безопасен. Она не изменяет старые `oauth_pending`, `sessions`, `start_limits`, `sync_heads`, `sync_operations` и не обращается к Drive. Для новой D1 полный [schema.sql](schema.sql) уже включает обе таблицы. Выполнение в настоящей D1 требует отдельной проверки; локальный тест использует заполненную старую SQLite-схему и подтверждает сохранность строк/DDL после двух применений и совместимость полной схемы.

Для восстановления удалённого root затем примените [migrations/new20261026_root_recreation.sql](migrations/new20261026_root_recreation.sql) до обновления Worker. Она только добавляет `sync_root_replacements` через `CREATE TABLE IF NOT EXISTS`, повторное применение сохраняет старые и новые строки. Полный `schema.sql` уже включает эту таблицу. Миграция не очищает данные и не вызывает Google API.

## Локальные проверки

Из корня ZeTer OS, Node 24+:

```powershell
node --check cloud/google-drive-broker/worker.mjs
node --test cloud/google-drive-broker/worker.test.mjs
git diff --check -- cloud/google-drive-broker
```

Тесты исполняют настоящий SQL/schema в `node:sqlite` (`:memory:`), fake D1 transport и fake Google fetch; сеть, аккаунты, настоящее `data/` и браузерный профиль не используются. В Node 24 встроенный SQLite может печатать ExperimentalWarning. Это не Miniflare/D1 runtime и не проверка живой авторизации.

Источники контрактов: [Cloudflare prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [D1 primary и sessions](https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession), [Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google access token metadata](https://docs.cloud.google.com/docs/authentication/token-types#user_access_tokens), [официальная реализация POST tokeninfo с Bearer header](https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/oauth2client.ts#L1172).
