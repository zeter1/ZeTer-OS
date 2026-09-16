# Сборка ZeTer OS в готовый Windows EXE

`build_exe.bat` создаёт нативную Windows-сборку ZeTer OS с Python runtime, `pywebview` и всей папкой `app/`. После успешной обычной сборки вручную устанавливать Python или WebView2 не требуется.

## Самый простой способ

1. Скачайте репозиторий и распакуйте его в обычную папку Windows.
2. Дважды щёлкните `build_exe.bat`.
3. Если Microsoft Edge WebView2 Runtime отсутствует, BAT сам скачает официальный Evergreen Bootstrapper Microsoft и установит Runtime.
4. Дождитесь:

```text
[OK] READY NATIVE BUILD CREATED AND VERIFIED.
```

5. Запускайте:

```text
dist\ZeTer-OS\ZeTer-OS.exe
```

При переносе на другой компьютер копируйте **всю папку** `dist\ZeTer-OS`.

## Что устанавливает и проверяет BAT

Сборщик автоматически:

- ищет Python 3.13;
- при отсутствии пытается установить Python 3.13 через `winget` для текущего пользователя;
- создаёт изолированную `.build-venv`;
- устанавливает `pywebview` из `requirements.txt`;
- устанавливает PyInstaller 6.22.3 и hooks;
- выполняет `pip check`;
- проверяет наличие Microsoft Edge WebView2 Runtime;
- при отсутствии WebView2 загружает официальный Microsoft Evergreen Bootstrapper и устанавливает Runtime;
- компилирует Python-код;
- запускает существующий `tools/check_project.py`;
- очищает предыдущую EXE-сборку;
- собирает ONEDIR-приложение;
- добавляет всю папку `app/` с HTML/CSS/JS/manifest/service worker;
- явно собирает модули `pywebview`;
- запускает `--self-test` уже на собранном EXE;
- сообщает об успехе только после проверки packaged runtime.

## Почему сборка ONEDIR

ZeTer OS — гибридное desktop/web-приложение: Python запускает `pywebview`, а интерфейс живёт в большой структуре `app/`. Для него ONEDIR надёжнее one-file:

- web-assets доступны как реальные файлы;
- WebView не зависит от временной распаковки one-file;
- writable `data/` остаётся рядом с EXE;
- проще сохранять резервные копии и диагностировать runtime;
- обновление статических web-файлов не смешивается с пользовательскими данными.

Используется `--contents-directory "."`, потому что текущая архитектура `run_zeter_os.py` считает каталог приложения через `__file__`. В плоской ONEDIR-сборке `app/` и EXE находятся в одном корне, поэтому существующая логика путей сохраняется без опасного переписывания приложения.

## WebView2 устанавливается автоматически

Современный backend `pywebview` на Windows использует Microsoft Edge WebView2. BAT проверяет стандартные каталоги WebView2 и, если Runtime отсутствует, загружает официальный Evergreen Bootstrapper Microsoft:

```text
https://go.microsoft.com/fwlink/p/?LinkId=2124703
```

Bootstrapper сам выбирает подходящую архитектуру Runtime. Это официальный рекомендованный Microsoft механизм распространения Evergreen WebView2 Runtime.

В `--ci` режиме machine-wide/per-user установка WebView2 пропускается, чтобы GitHub Actions не менял системное окружение runner. Packaged self-test при этом всё равно проверяет Python/pywebview и web-assets без открытия GUI.

## Что проверяет packaged self-test

Runtime hook `build_support/package_runtime.py` при обычном запуске ничего не делает. При:

```text
ZeTer-OS.exe --self-test
```

он до открытия окна проверяет:

- импорт `webview`;
- импорт `problem_logs`;
- наличие `app/index.html`;
- наличие `app/manifest.json`;
- наличие `app/service-worker.js`;
- наличие `app/js/core/version.js`;
- что `index.html` действительно содержит HTML.

Таким образом, сборка с потерянной папкой `app/` не может пройти как «готовая».

## build_exe.bat и build_release.cmd — разные задачи

- `build_exe.bat` — создаёт **нативный Windows EXE** с Python/pywebview runtime.
- `build_release.cmd` — существующий безопасный builder исходной portable ZIP-версии на Python.

Оба сценария сохраняются: новый EXE-builder не ломает проверенный ZIP release pipeline.

## Повторная сборка

Просто снова запустите `build_exe.bat`. BAT очищает только `build/` и `dist\ZeTer-OS`, не удаляя исходники или пользовательский `data/` проекта.

`.build-venv` можно сохранить для ускорения. При несовпадении версии Python оно пересоздаётся автоматически.

## CI / Codex

```bat
build_exe.bat --ci
```

Packaging в GitHub Actions должен запускаться только на `[package]`-коммитах или вручную через `workflow_dispatch`. Обычные README/docs-правки не должны собирать тяжёлый desktop bundle.

## Если сборка упала

Смотрите первое сообщение `[ERROR]`/traceback. Частые причины:

- Python 3.13 отсутствует и `winget` недоступен;
- proxy/антивирус блокирует PyPI или официальный WebView2 Bootstrapper Microsoft;
- нет права записи в папку проекта;
- web-assets повреждены и `tools/check_project.py` их отклоняет;
- защитное ПО блокирует новый unsigned EXE.

BAT не подавляет такие ошибки и не пишет `[OK]`, пока packaged self-test не пройдёт.

## Что можно удалить

После успешной сборки можно удалить:

```text
build/
.build-venv/
ZeTer-OS.spec
```

Для запуска оставьте целиком:

```text
dist\ZeTer-OS\
```
