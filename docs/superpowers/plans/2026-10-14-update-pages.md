# Проверка обновлений через GitHub Pages

Пользователь согласовал схему в чате и поручил выполнить локально. Публикацию
и сборку EXE выполняет пользователь. Коммитов и внешних изменений в этой задаче нет.

Цель: Windows-сборка читает фиксированный HTTPS updates.json на Pages, сравнивает
числовую версию и после явного действия пользователя скачивает полный ZIP из Releases.
REST API в клиентском пути не используется. Существующие staged-проверки и rollback
сохраняются. Текущие посторонние изменения не откатываются.

Владельцы: app_updater.py — feed/HTTPS/проверка кандидата; tools/build_update_feed.py —
генерация из реального ZIP и проверка опубликованных bytes; ci.yml — Release → проверка
→ Pages; update-ui-utils.js — интервал 6 часов; docs/UPDATES.md — основной контракт.

- [x] Сначала синтетические тесты: feed/версии/URL/размер/hash/HTTP/cooldown.
- [x] Строгий feed schema 1, repository/platform/tag/version/name/url/size/sha256/notes;
  ограничение 64 КиБ, exact Pages URL без redirects, обязательный SHA256.
- [x] Генератор сверяет ZIP/manifest/checksum; проверка загрузки идёт до записи feed.
- [x] CI публикует только main целевого репозитория; immutable tag на каждый запуск;
  Pages artifact содержит web-приложение и feed, tokens остаются только в CI.
- [x] JS startup/6 часов/manual/cooldown, справка и canonical docs, версия/PWA/CHANGELOG.
- [x] Профильные smoke, strict-check, независимая проверка diff и границ исполнения.

Проверки выполняются на synthetic fixtures в work/; реальные data/ и установленный
EXE не используются. Live Pages/CI/новый EXE остаются NOT_VERIFIED до публикации.
Отдельно проверить: malformed feed не считается отсутствием обновления; чужой URL
и redirect отклоняются; равная/старая версия не скачивается; неверный hash и отказ
публикации не создают feed. SHA256 не заменяет доверие к издательскому репозиторию.
