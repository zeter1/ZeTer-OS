# ZeTer OS

**Hybrid desktop productivity application built with Python, pywebview, HTML, CSS and JavaScript.**

ZeTer OS is a personal desktop workspace for Windows with multiple workspaces, notes, tasks, calendar data, files, tables, images, settings, backups and restore tools. The UI is implemented as a modular web frontend and is hosted inside a Python desktop shell through `pywebview`.

## Highlights

- Multiple desktop workspaces with persistent state
- Notes, tasks, calendar, tables, files and image-oriented tools
- Python ↔ JavaScript native bridge through pywebview
- Local data storage in a dedicated `data/` directory
- Windows-readable exports for important user content
- Backups, restore points and recovery-oriented data handling
- Per-user Windows autostart support without administrator rights
- Portable release builder that excludes user data and development artifacts
- Modular JavaScript core with documented ownership and dependencies
- Automated structural validation and scenario smoke tests

## Architecture

```text
ZeTer OS
├── run_zeter_os.py          # Python desktop entry point / native bridge
├── app/                     # HTML/CSS/JavaScript application
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── app.js           # composition root
│       └── core/            # feature and domain modules
├── docs/                    # architecture, data model and maintenance docs
├── tools/                   # validation, documentation and smoke-test tooling
├── build_release.cmd        # portable release builder
└── check_project.cmd        # full project verification
```

The frontend is intentionally split into focused core modules while `app/js/app.js` remains the composition root for application state, DOM wiring, startup, persistence, windows and native adapters.

## Data and reliability

When launched through Python, ZeTer OS stores its working state in `data/` next to the application. This directory is intentionally excluded from Git because it contains user-specific state and generated files.

The application also maintains Windows-readable copies of important content, including formats such as DOCX, CSV and ICS, and supports backups and restore points. Release builds intentionally exclude `data/`, logs, Git metadata and development-only files.

## Requirements

- Windows
- Python 3
- `pywebview >= 5.0`
- Node.js is recommended for the full JavaScript verification suite

Install Python dependencies:

```powershell
py -3 -m pip install -r requirements.txt
```

Run the application:

```powershell
py -3 run_zeter_os.py
```

or use:

```text
start_zeter_os.cmd
```

## Validation

The repository contains its own structural checks and smoke-test suite.

Python/project checks:

```powershell
python tools/check_project.py
```

JavaScript scenario smoke suite:

```powershell
node tools/run_smokes.js
```

Full Windows verification:

```powershell
.\check_project.cmd --strict-node --no-pause
```

On the source snapshot published here, the project checker reports **111 checks passed, 0 warnings and 0 failures**, and the scenario smoke suite passes successfully.

## Documentation

The `docs/` directory contains detailed project documentation, including:

- architecture and module ownership;
- data model and state lifecycle;
- Python/native bridge contracts;
- frontend workflow and editing guidance;
- testing and troubleshooting;
- UI contracts and scenario maps.

`AGENTS.md` contains repository-specific rules for AI-assisted development and verification.

## Portable release

A clean portable ZIP can be built with:

```text
build_release.cmd
```

The release builder validates the archive, checks extraction into Windows-style paths and excludes user data and development artifacts.

## Project status

This is an actively developed personal project used to explore reliable desktop application architecture, local-first data handling, Windows integration and AI-assisted software engineering.

## License

No open-source license is currently granted. The source code is published for portfolio and code-review purposes.
