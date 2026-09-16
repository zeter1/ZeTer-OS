**Язык / Language:** [Русский](README.md) · **English**

# ZeTer OS

**ZeTer OS** is a hybrid Windows workspace built with Python, pywebview, HTML, CSS, and JavaScript. It combines notes, tasks, calendar, files, spreadsheets, images, and other everyday tools in one local application.

The project combines a Python desktop shell with a modular web interface and focuses on local data storage, backup, recovery, and understandable architecture.

🌐 **Web version:** https://dkl.do.am/portfolio/ZeTerOS/index.html

## What the project demonstrates

- hybrid Python + HTML/CSS/JavaScript desktop architecture;
- frontend ↔ native integration through the `pywebview` bridge;
- a local-first approach to user data;
- decomposition of a large frontend into functional modules and responsibility areas;
- export, backups, and restore points as part of the product architecture;
- dedicated structural checks and scenario smoke tests;
- portable-release preparation with user data separated from source and development files.

## Main features

- multiple independent workspaces;
- notes, tasks, calendar, spreadsheets, files, and image tools;
- local user-data storage;
- Python ↔ JavaScript integration through `pywebview`;
- export to familiar Windows formats;
- backups and restore points;
- Windows autostart without mandatory administrator privileges;
- portable builds;
- modular JavaScript architecture;
- structural checks and smoke tests.

## Installation

### Option 1 — web version

To inspect the interface and main features, open:

**https://dkl.do.am/portfolio/ZeTerOS/index.html**

### Option 2 — local desktop version

1. Install Python 3 for Windows.
2. Download the project using **Code → Download ZIP** or Git:

```bash
git clone https://github.com/zeter1/ZeTer-OS.git
cd ZeTer-OS
```

3. Install dependencies:

```powershell
py -3 -m pip install -r requirements.txt
```

Node.js 22 is recommended for the full JavaScript verification set.

## Launch

```powershell
py -3 run_zeter_os.py
```

or:

```text
start_zeter_os.cmd
```

## Usage

1. Start ZeTer OS.
2. Create or select a workspace.
3. Use the required modules: notes, tasks, calendar, spreadsheets, files, and other tools.
4. Data is stored locally, so the workspace can continue across launches.
5. Use export and backups for important data.
6. Create a restore point before major changes or moving the application.

ZeTer OS is designed as one local environment, so the major sections work as parts of a shared workspace rather than as unrelated pages.

## Architecture

```text
ZeTer OS
├── run_zeter_os.py          # Python entrypoint and native bridge
├── problem_logs.py          # centralized diagnostics
├── app/
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── app.js           # composition root
│       └── core/            # functional modules
├── docs/
├── tools/
├── build_release.cmd
└── check_project.cmd
```

The frontend is split into focused modules while `app/js/app.js` remains the central composition point for application state, DOM, windows, persistence, and native adapters.

## Data and reliability

The desktop version stores workspace state locally under `data/` next to the application. User data is not committed to Git.

Important data can be exported to formats including `DOCX`, `CSV`, and `ICS`. Backups and restore points are also supported. Portable releases are built without user data, logs, Git metadata, or development-only files.

## Project verification

Basic structural verification:

```powershell
python tools/check_project.py
```

JavaScript smoke tests:

```powershell
node tools/run_smokes.js
```

Full Windows verification:

```powershell
.\check_project.cmd --strict-node --no-pause
```

GitHub Actions compiles the Python layer and runs `python tools/check_project.py --strict-node` on Windows with Python and Node.js. Real desktop scenarios involving a `pywebview` window, file dialogs, and user state still require runtime verification.

## Documentation

The `docs/` directory covers architecture and module responsibilities, the data model, the Python/native bridge, frontend contracts, testing, diagnostics, and UI scenarios.

`AGENTS.md` contains development guidance for AI-assisted work on the project.

## Support and security

- [`SUPPORT.md`](SUPPORT.md) — useful information for bug reports;
- [GitHub Issues](https://github.com/zeter1/ZeTer-OS/issues) — regular reproducible bugs;
- [`SECURITY.md`](SECURITY.md) — reporting potential vulnerabilities.

## Portable build

```text
build_release.cmd
```

The build process excludes user data, Git metadata, and development-only files.

## License

The project is not distributed under an open-source license. The source code is published as part of the portfolio and for implementation review.