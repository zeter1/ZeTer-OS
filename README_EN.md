**Язык / Language:** [Русский](README.md) · **English**

# ZeTer OS

<img src="app/assets/icons/zeter-logo.svg" alt="ZeTer OS logo" width="96" height="96" />

**ZeTer OS** is a Windows workspace with an OS-inspired interface: desktops, windows, a Start menu, File Explorer, and productivity apps. Built with Python, `pywebview`, HTML, CSS, and JavaScript, it shares a web UI across the native Windows application and the browser.

![ZeTer OS desktop and applications](docs/images/zeter-os-banner.png)

**Quick links:** [Try online](https://dkl.do.am/zeteros/index.html) · [Windows downloads](https://github.com/zeter1/ZeTer-OS/releases) · [Changelog](CHANGELOG.md) · [Report a bug](https://github.com/zeter1/ZeTer-OS/issues) · [Developer's GitHub](https://github.com/zeter1)

**Source version on `main`: 4.0.64 (October 19, 2026).** The version is defined in [`app/js/core/version.js`](app/js/core/version.js). Check [Releases](https://github.com/zeter1/ZeTer-OS/releases) for the latest published Windows build. The source tree, Windows EXE, and uCoz deployment can be on different versions.

## Choose how to run it

| Goal | Option |
| --- | --- |
| Try the UI without installing anything | [Open the web app](https://dkl.do.am/zeteros/index.html) |
| Run a packaged desktop app on Windows x64 | [Download a portable ZIP](https://github.com/zeter1/ZeTer-OS/releases) |
| Inspect or develop the source code | [Run from Python](#run-from-source) |

### Packaged Windows app (no Python installation)

> GitHub Releases are marked **Prerelease**: they are preview builds intended for testing.

1. Open [Releases](https://github.com/zeter1/ZeTer-OS/releases) and select a build.
2. Under **Assets**, download `ZeTer-OS-<version>-Windows-x64.zip` and the matching `.sha256.txt` checksum file.
3. Optionally verify the downloaded ZIP against the SHA-256 in that file. In PowerShell: `Get-FileHash .\ZeTer-OS-*-Windows-x64.zip -Algorithm SHA256`.
4. **Extract the entire ZIP** into its own folder, then launch `ZeTer-OS.exe`.

The portable distribution includes Python and the application's other runtime files. It does **not** remove the requirement for **Microsoft Edge WebView2 Runtime**, which may need to be installed separately on the target PC. Get it from [Microsoft's official WebView2 page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). Keep the EXE, DLLs, `app/`, `zeter-update.json`, and other packaged files together.

The EXE is not publisher-signed, so Windows/SmartScreen may display a warning. Download builds only from [this repository's Releases](https://github.com/zeter1/ZeTer-OS/releases) and compare the checksum.

### Browser / PWA

**Web address:** https://dkl.do.am/zeteros/index.html

Runs without Python or the Windows executable. The browser stores workspace data primarily in **IndexedDB**, rather than the desktop application's local `data/` folder. Python bridge calls, Windows integration, and some local-document workflows are native-only.

The web app checks a verified set of cached assets on normal page load or refresh and notifies already-open tabs about updates without forcibly reloading them. When migrating from an older deployment, it may be necessary to close old tabs and reopen the page. See the [uCoz deployment documentation](docs/UCOZ.md).

**Important:** browser and desktop data do not sync automatically. Clearing site data or a browser profile can remove saved work; use export and backups.

## Features

- **Desktop shell:** multiple workspaces, File Explorer, folders, windows, taskbar, Start menu, shortcuts, and appearance settings.
- **Productivity:** notes, calendar, and project-based tasks with categories, board, list, and overview views.
- **Content:** spreadsheets, files, images, a link library, and a prompt library.
- **Time tracking:** timer and pauses, manual entries, project/task associations, calendar planning, reports, weekly summaries, and CSV export.
- **Calculators:** configurable business calculation cards.
- **System tools:** settings, keyboard shortcuts, notification center, and a system monitor with metrics and charts.
- **Reliability:** local state storage, exports, backups, restore points, and a Security Center.
- **Windows integration:** native operations through `pywebview` and optional per-user Windows startup.

Editing imported **DOC/DOCX** documents in desktop mode requires **LibreOffice**, installed separately. Features vary by execution mode and deployed version; consult the [built-in help implementation](app/js/core/help-content.js) and [changelog](CHANGELOG.md).

## Getting started

1. Open the web app or run `ZeTer-OS.exe`.
2. Complete first-run setup and create or select a workspace.
3. Launch apps from Start, the taskbar, shortcuts, or File Explorer.
4. Back up or export important work before moving the installation or restoring state.
5. Review the [changelog](CHANGELOG.md) for updates. The Windows EXE also has in-app update checks.

## Run from source

Use Windows and Python 3 with the dependency in `requirements.txt` (`pywebview`). CI uses **Python 3.13**. From PowerShell:

```powershell
git clone https://github.com/zeter1/ZeTer-OS.git
cd ZeTer-OS
py -3 -m pip install -r requirements.txt
py -3 run_zeter_os.py
```

Alternatively, run `start_zeter_os.cmd`. This is the **Python source distribution**, not the packaged Windows EXE. See [README_PYTHON.md](README_PYTHON.md) for more information (Russian).

## Local data and recovery

| Mode | Primary storage |
| --- | --- |
| Windows EXE / Python desktop | `data/zeter-os-state.json` (normally alongside the app; the active path can be relocated) |
| Browser / PWA | IndexedDB under the current browser profile and site origin |

Desktop backups live under `data/backups/`, and structured diagnostics are kept in **`Логи проблем/`** next to the app. Start troubleshooting with `Логи проблем/latest_run.json`, which points to the latest session. Older builds may use `data/logs/zeter-os.log`.

**Do not delete `data/`, backups, IndexedDB, or PWA caches to fix a startup problem before safeguarding important data.** Read the [data model](docs/DATA_MODEL.md), [troubleshooting guide](docs/TROUBLESHOOTING.md), and [support guide](SUPPORT.md).

## Updates

- **Windows EXE:** checks a GitHub Pages `updates.json` feed, offers a newer version, and—after user confirmation—downloads and verifies a ZIP from GitHub Releases. Installation includes failure recovery/rollback. [Update details](docs/UPDATES.md).
- **Browser:** verifies the published web-asset snapshot, keeping user data and the application update lifecycle separate. [Web deployment](docs/UCOZ.md).
- **Python source:** updated separately by developers; the EXE updater does not replace the source checkout.

See the full [CHANGELOG.md](CHANGELOG.md) and [Windows release notes](RELEASE_NOTES_RU.md). The current source version does not necessarily match the most recently published binary.

## Architecture

```text
ZeTer-OS/
├── run_zeter_os.py          # native launcher, local HTTP server and bridge
├── problem_logs.py          # structured diagnostics
├── app_updater.py           # EXE update discovery/download
├── update_runner.py         # transactional replacement and rollback
├── app/
│   ├── index.html           # web shell
│   ├── service-worker.js    # consistent cached web snapshots
│   ├── css/
│   └── js/
│       ├── app.js           # state and UI composition root
│       └── core/            # focused feature and UI modules
├── docs/                    # architecture and operating contracts
├── tools/                   # checks, smoke tests and builders
├── build_exe.bat            # native Windows x64 build
├── build_release.cmd        # separate Python portable ZIP
└── check_project.cmd
```

Python starts the local server and `pywebview` window. JavaScript uses a native bridge when available, while the browser runs the web UI without that API and maintains separate storage. `app/js/app.js` orchestrates state and UI while feature logic is separated into `app/js/core/`.

**Engineering documentation:** [architecture](docs/ARCHITECTURE.md) · [code map](docs/CODEMAP.md) · [data model](docs/DATA_MODEL.md) · [native bridge](docs/NATIVE_BRIDGE.md) · [documentation index](docs/README.md) · [repository guidelines](AGENTS.md).

## Testing and building

The JavaScript smoke suite uses **Node.js 22**. Typical checks:

```powershell
python tools/check_project.py
node tools/run_smokes.js
.\check_project.cmd --strict-node --no-pause
```

[GitHub Actions CI](https://github.com/zeter1/ZeTer-OS/actions/workflows/ci.yml) compiles Python and runs strict project checks on Windows. Native EXE packaging is only requested by `workflow_dispatch` or an intentional `[package]` commit. Source-level checks and packaged self-tests do **not** replace manual testing of the actual GUI, file dialogs, and persistent data on Windows.

[`build_exe.bat`](BUILD_EXE.md) produces `dist/ZeTer-OS/` with the EXE and required assets. `build_release.cmd` instead creates a **Python-based portable ZIP**. For direct uCoz web deployment, use `prepare_web.cmd`; `build_ucoz.cmd` produces a separate ZIP option. See the [uCoz guide](docs/UCOZ.md) and [testing guide](docs/TESTING.md).

## Limitations, support, and security

- **Prerelease builds:** protect important data before upgrading.
- **Unsigned EXE:** Windows may warn about an unknown publisher.
- **Different runtimes:** some native functions are unavailable on the web, and browser and desktop data are separate.
- **No open-source license:** source availability on GitHub is not permission to freely reuse, modify, or redistribute the code.

For reproducible defects, open an [Issue](https://github.com/zeter1/ZeTer-OS/issues) with the version, runtime, steps, and **sanitized** diagnostics. Never publish raw `data/` contents, user documents, backup archives, tokens, or other private information without review. [Support](SUPPORT.md) · [Security](SECURITY.md).

## Developer contacts

- [GitHub](https://github.com/zeter1) · [Email](mailto:zeter11@gmail.com) · [Telegram](https://t.me/zeter1) · [Telegram community](https://t.me/zeterchat)
- [LinkedIn](https://www.linkedin.com/in/zeter/) · [Facebook](https://www.facebook.com/zeter1) · [VK](https://vk.ru/zeter1)
- [Instagram](https://www.instagram.com/zeter1992/) · [TenChat](https://tenchat.ru/zeter) · [X](https://x.com/zeter1) · [Threads](https://www.threads.com/@zeter1992) · [OK](https://ok.ru/zeter1)
