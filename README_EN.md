**Language / Язык:** [Русский](README.md) · **English**

<p align="center">
  <img src="app/assets/icons/zeter-logo.svg" alt="ZeTer OS" width="100" height="100">
</p>

# ZeTer OS

**An OS-inspired productivity workspace for Windows and the browser.**

Desktops · windows and Start menu · File Explorer · notes and tasks · files · backups

[🚀 Try online](https://dkl.do.am/zeteros/index.html) · [⬇️ Download for Windows](https://github.com/zeter1/ZeTer-OS/releases) · [📋 Changelog](CHANGELOG.md) · [🐞 Report a bug](https://github.com/zeter1/ZeTer-OS/issues)

[![CI](https://github.com/zeter1/ZeTer-OS/actions/workflows/ci.yml/badge.svg)](https://github.com/zeter1/ZeTer-OS/actions/workflows/ci.yml)

![ZeTer OS desktop and applications](docs/images/zeter-os-banner.png)

ZeTer OS is **not a standalone operating system or a Windows replacement**. It is an application shell that brings everyday tools into a desktop-like environment with windows, workspaces, and a Start menu. The same HTML/CSS/JavaScript interface runs in the browser and in a Windows app, where Python and `pywebview` provide local storage and native capabilities.

> **Project status.** Published Windows builds are marked **Prerelease** and intended for testing. Back up important data before updating or migrating. The source version is defined in [`app/js/core/version.js`](app/js/core/version.js); it may differ from the latest [Windows release](https://github.com/zeter1/ZeTer-OS/releases) or the version hosted on uCoz.

## Contents

- [Quick start](#quick-start)
- [Features and workflows](#features-and-workflows)
- [Windows vs browser](#windows-vs-browser)
- [Install the Windows app](#install-the-windows-app)
- [Data, backups, and recovery](#data-backups-and-recovery)
- [Updates and changelog](#updates-and-changelog)
- [Troubleshooting](#troubleshooting)
- [Development and architecture](#development-and-architecture)
- [Validation and builds](#validation-and-builds)
- [Limitations and contact](#limitations-and-contact)

## Quick start

| What you want to do | Choose | Requirements |
| --- | --- | --- |
| Explore the interface | **[Open the web app](https://dkl.do.am/zeteros/index.html)** | Modern browser; no installation |
| Use ZeTer OS locally on Windows | **[Windows x64 ZIP from Releases](https://github.com/zeter1/ZeTer-OS/releases)** | Extract the ZIP; WebView2 Runtime |
| Study or modify the project | **[Run from source](#development-and-architecture)** | Windows, Python 3, dependencies |
| See what changed | **[CHANGELOG.md](CHANGELOG.md)** | Nothing to install |

**Your first session:**
1. Open the website or run `ZeTer-OS.exe` from the extracted Windows archive.
2. Complete first-run setup and create or select a workspace.
3. Open the Start menu and launch an app; arrange windows across your workspace.
4. Learn where to export or back up your work before storing anything important.

You only need the [web URL](https://dkl.do.am/zeteros/index.html) to try the browser edition. **Do not double-click `app/index.html` as a substitute for the desktop launcher**: the Python bridge will not be available.

## Features and workflows

| Area | What it offers |
| --- | --- |
| **Desktop workspace** | Multiple desktops, windows, File Explorer, folders, shortcuts, taskbar, Start menu, themes |
| **Personal productivity** | Notes, calendar, tasks, projects, categories, board and list views |
| **Content and knowledge** | Files, spreadsheets and images, link library, AI prompt library |
| **Time tracking** | Pausable timer, manual entries, task/project association, history, weekly reports, CSV export |
| **Business tools** | Configurable calculator cards |
| **System tools** | Settings, keyboard shortcuts, notification center, system monitor and charts |
| **Data safety** | Local persistence, export, backups, restore points, Security Center |

### Example workflows

**Plan your day:** organize a project and its tasks, schedule work in the calendar, track time, and review your time log.

**Organize working materials:** keep notes, documents, images, spreadsheets, links, and reusable prompts in one environment.

**Personalize the workspace:** customize desktops, shortcuts, and appearance; navigate with Start and windows rather than juggling unrelated tabs.

The exact feature set depends on the runtime and deployed version. Consult the [in-app help content](app/js/core/help-content.js) and [changelog](CHANGELOG.md) for additional detail.

## Windows vs browser

| Capability | Windows EXE / Python desktop | Browser / PWA |
| --- | --- | --- |
| Shared UI and web-based apps | Yes | Yes |
| Install Python yourself | **Not for the packaged EXE** | No |
| Primary state | Local `data/zeter-os-state.json` file | Site IndexedDB |
| Native Windows integration | Via `pywebview` | Unavailable |
| Local-document workflows | Additional desktop bridge capabilities | Browser API limitations |
| Updates | Windows release update channel | Published web asset updates |
| Automatic cross-runtime syncing | **No** | **No** |

Editing imported **DOC/DOCX** documents in desktop mode requires a separate **LibreOffice** installation. Other capabilities may also differ between web and native modes.

**Web app:** https://dkl.do.am/zeteros/index.html. It is deployed independently of GitHub Releases. Browser data belongs to a particular browser profile and website origin; clearing site storage can erase saved work.

## Install the Windows app

### 1. Download and run

1. Open [GitHub Releases](https://github.com/zeter1/ZeTer-OS/releases) and choose a published build.
2. In **Assets**, download **`ZeTer-OS-<version>-Windows-x64.zip`**, **not** `Source code.zip`.
3. **Extract the entire archive** to its own folder, for example `C:\Apps\ZeTer-OS`. Do not launch the executable from inside the ZIP.
4. Run `ZeTer-OS.exe`. Keep the executable, DLLs, `app/`, `zeter-update.json`, and other bundled files together.

You do **not** need to install Python for the packaged EXE: it contains the necessary Python runtime files. The embedded window, however, requires **Microsoft Edge WebView2 Runtime**. If it is missing, install it from [Microsoft's official WebView2 page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). The source-based installation does require Python.

The EXE is not digitally signed by a publisher, so Windows/SmartScreen may report an unknown publisher. Obtain archives from the [official project Releases](https://github.com/zeter1/ZeTer-OS/releases).

### 2. SHA-256 verification is optional

Assets may also include `ZeTer-OS-<version>-Windows-x64.sha256.txt`. **You do not need this file to run the app.** It contains a checksum you can use to verify the download.

~~~powershell
Get-FileHash .\ZeTer-OS-*-Windows-x64.zip -Algorithm SHA256
~~~

Compare `Hash` against the value in the `.sha256.txt` file **from the same release**. If they differ, do not use the ZIP; download it again. A matching value verifies integrity relative to the published checksum, but is not, by itself, proof of publisher identity.

### 3. Upgrade or move the app manually

If automatic updates are unavailable or you need to migrate to another machine:

1. Export a **ZIP backup** from the running old version, then close the app.
2. Save a separate copy of the complete active `data/` folder. If you configured a different data location, use that actual path.
3. Download the new build and **extract it into a new empty folder**. Do not mix files from two versions.
4. With the old app fully closed, transfer user data following the [data model](docs/DATA_MODEL.md); do not overwrite it with empty new-state files.
5. Launch the new version, check your data and key workflows, and retain the old installation until the migration is verified. Update any shortcuts or autostart entry if necessary.

See the [update and recovery guide](docs/UPDATES.md) for package validation and rollback details.

## Data, backups, and recovery

**Critical distinction:** Windows and browser data **do not sync automatically**. Export or back up important work before replacing a computer, reinstalling Windows, clearing browser storage, or performing an upgrade.

| Runtime / purpose | Location |
| --- | --- |
| Windows EXE or Python source | `data/zeter-os-state.json` — primary state (configured path may differ) |
| Desktop backups | `data/backups/` |
| Browser | IndexedDB for the current profile and origin |
| Desktop diagnostics | `Логи проблем/latest_run.json` and the session it references |

**Recover safely:** first copy the current state, even if it appears damaged. Then inspect an appropriate backup and restore intentionally; ZeTer OS does not promise to replace state with a backup automatically. Keep the original state and logs if recovery fails.

Do not delete `data/`, `data/backups/`, IndexedDB, or PWA caches as a generic startup fix. This may destroy your only remaining copy of the data.

Read the [data model](docs/DATA_MODEL.md), [state lifecycle](docs/STATE_LIFECYCLE.md), and [troubleshooting guide](docs/TROUBLESHOOTING.md).

## Updates and changelog

**Windows EXE.** The app checks a GitHub Pages `updates.json` feed at startup, periodically, and on request. When a newer build is available, it offers an upgrade; **downloading from GitHub Releases and installing the ZIP require user action**. Packages are verified and the update process includes recovery/rollback protections. Some old EXE versions predate the current update mechanism. [Technical update contract](docs/UPDATES.md).

**Browser / PWA.** The uCoz-hosted site checks its published web-asset snapshot when opened or refreshed, and already-open tabs may show update notifications. After a major deployment, closing old tabs and reopening the site may be necessary. Never clear site storage without backing up important data. [Web deployment guide](docs/UCOZ.md).

**Python checkout.** Developers update source separately; the EXE updater does not update Git checkouts.

### Versions and release history

- [**CHANGELOG.md**](CHANGELOG.md) — features, fixes and project changes.
- [**Releases**](https://github.com/zeter1/ZeTer-OS/releases) — Windows ZIP, SHA-256 and release dates.
- [**RELEASE_NOTES_RU.md**](RELEASE_NOTES_RU.md) — Windows release notes (Russian).
- [**`version.js`**](app/js/core/version.js) — web-application source version on `main`.

A commit in `main`, the newest published Windows ZIP, and the uCoz website may have different release dates and versions.

## Troubleshooting

| Symptom | First things to check |
| --- | --- |
| `ZeTer-OS.exe` will not start | Was the full ZIP extracted? Are `app/` and the DLLs present? Is WebView2 Runtime installed? |
| Data appears to be missing | Confirm the app instance, browser profile, active `data/` path, and backups |
| Website shows an old interface | Refresh and close stale tabs; check the deployed version **without wiping IndexedDB** |
| A Windows-specific feature fails on the website | Check [runtime differences](#windows-vs-browser): the Python bridge is not available in browsers |
| Update check or installation fails | Check connectivity and [update diagnostics](docs/UPDATES.md); do not delete `data/updates/` |
| The desktop hangs or crashes | Start with `Логи проблем/latest_run.json` and the [troubleshooting guide](docs/TROUBLESHOOTING.md) |

### Report a reproducible issue

Open a [GitHub Issue](https://github.com/zeter1/ZeTer-OS/issues) with the **version**, **runtime** (EXE, Python, or website), **reproduction steps**, and **expected vs actual behavior**. You can attach **sanitized** diagnostic excerpts from `Логи проблем/`: `latest_run.json`, `summary.json`, or the relevant lines from `problems.jsonl` / `events.jsonl`. Older versions may also use `data/logs/zeter-os.log`.

**Do not upload** entire `data/` folders, documents, backup archives, tokens, personal information, or unreviewed logs. See [Support](SUPPORT.md), [Security](SECURITY.md), and the [diagnostic log contract](<Логи проблем/README_FOR_CODEX.md>) (Russian).

## Development and architecture

**Stack:** Python 3 · `pywebview` · HTML · CSS · JavaScript · IndexedDB · local HTTP · GitHub Actions · PyInstaller (Windows packaging).

### Run from source

Requires **Windows**, **Python 3**, and Git for cloning. CI uses **Python 3.13**. In PowerShell:

~~~powershell
git clone https://github.com/zeter1/ZeTer-OS.git
cd ZeTer-OS
py -3 -m pip install -r requirements.txt
py -3 run_zeter_os.py
~~~

You can also use `start_zeter_os.cmd`. This installs `pywebview` from `requirements.txt` and is **not the same distribution as the packaged EXE**. More information: [README_PYTHON.md](README_PYTHON.md) (Russian).

### Project layout

~~~text
ZeTer-OS/
├── run_zeter_os.py        # native launcher, HTTP server and Python bridge
├── problem_logs.py        # structured diagnostics
├── app_updater.py         # update discovery and download
├── update_runner.py       # replacement and rollback
├── app/
│   ├── index.html         # shared web shell
│   ├── service-worker.js  # consistent PWA cache snapshots
│   ├── css/               # domain-oriented CSS modules
│   └── js/
│       ├── app.js         # composition root
│       └── core/          # UI and domain modules
├── docs/                  # architectural and operational contracts
├── tools/                 # validators, smoke tests and build helpers
├── build_exe.bat          # native Windows build
├── build_release.cmd      # separate Python portable ZIP
└── check_project.cmd      # project validation
~~~

**Execution flow:** `run_zeter_os.py` starts a local HTTP server and a `pywebview` window → `app/index.html` loads → `app/js/app.js` coordinates state, DOM, and `app/js/core/` modules → desktop uses the Python bridge, while the browser uses its separate web storage. Updating a packaged EXE is a separate lifecycle from normal app-state persistence.

**For engineers:** [architecture](docs/ARCHITECTURE.md) · [code map](docs/CODEMAP.md) · [core API index](docs/CORE_API_INDEX.md) · [native bridge](docs/NATIVE_BRIDGE.md) · [data model](docs/DATA_MODEL.md) · [documentation index](docs/README.md) · [repository guidelines](AGENTS.md).

## Validation and builds

The JavaScript smoke suite uses **Node.js 22**. From the project root:

~~~powershell
python tools/check_project.py
node tools/run_smokes.js
.\check_project.cmd --strict-node --no-pause
~~~

[GitHub Actions CI](https://github.com/zeter1/ZeTer-OS/actions/workflows/ci.yml) runs Python compilation and strict project checks on Windows. **Native EXE packaging is separate**, triggered manually (`workflow_dispatch`) or by an explicitly marked `[package]` commit. README-only changes do not publish a release.

| Target | Tool | Output |
| --- | --- | --- |
| Native Windows EXE with runtime | [`build_exe.bat`](BUILD_EXE.md) | `dist/ZeTer-OS/` containing `ZeTer-OS.exe` |
| Python portable ZIP | `build_release.cmd` | A different format, run using Python |
| uCoz website files | `prepare_web.cmd` or `build_ucoz.cmd` | Web deployment, **not a Windows EXE** |

Automated checks and packaged self-tests **do not replace** hands-on Windows verification of the GUI, file dialogs, persistence, and updates. See [testing](docs/TESTING.md), [EXE build instructions](BUILD_EXE.md), and [uCoz deployment](docs/UCOZ.md).

## Limitations and contact

- **Prerelease:** builds are for testing; maintain backups of important work.
- **Unsigned EXE:** Windows may show an unknown-publisher warning.
- **No automatic sync** between browser and desktop; not every native capability is available on the web.
- **No open-source license:** publishing source code does not automatically grant permission to copy, modify, or redistribute it.

**Developer:** [GitHub zeter1](https://github.com/zeter1) · [Email](mailto:zeter11@gmail.com) · [Telegram](https://t.me/zeter1) · [Telegram community](https://t.me/zeterchat) · [LinkedIn](https://www.linkedin.com/in/zeter/)

Other profiles: [Facebook](https://www.facebook.com/zeter1) · [VK](https://vk.ru/zeter1) · [Instagram](https://www.instagram.com/zeter1992/) · [TenChat](https://tenchat.ru/zeter) · [X](https://x.com/zeter1) · [Threads](https://www.threads.com/@zeter1992) · [OK](https://ok.ru/zeter1).

Feature ideas and bug reports are welcome in [Issues](https://github.com/zeter1/ZeTer-OS/issues).
