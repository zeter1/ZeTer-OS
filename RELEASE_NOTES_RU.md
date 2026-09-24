# Изменения Windows-сборки

- Готовая desktop-сборка ZeTer OS теперь публикуется как постоянный GitHub Release.
- Portable ZIP содержит `ZeTer-OS.exe`, встроенный Python/pywebview runtime и полный web-слой приложения.
- Перед публикацией GitHub Actions запускает compile, полную проектную проверку, сборку native EXE и packaged `--self-test`.
- В релиз добавлен отдельный SHA-256 для проверки целостности portable-архива.
- README теперь прямо указывает, где скачать готовую Windows-версию и что архив нужно распаковывать целиком.

## Проверка

CI подтверждает корректность packaged runtime и наличие обязательных файлов `app/index.html` и `app/js/core/version.js`. Реальные desktop-сценарии с пользовательскими данными, файловыми диалогами и установленным WebView2 требуют проверки на целевой Windows-машине.
