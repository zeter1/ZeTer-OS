# Security recovery implementation plan

**Goal:** Implement the three improvements approved in this chat: existing-file recovery verification, full backup history, selective recovery.
**Architecture:** Strict shared archive reader; native full-payload ZIP/vault with isolated immutable staging and durable GC leases; pure JSON selective planner; UI and primary transaction integration owned by app.js.
**Constraints:** Existing dirty edits preserved; no commits/deployment/EXE build; dark-only UI; no real data in tests; passwords memory-only; ZIP and expanded data <=120 MiB, JSON <=50 MiB, <=1200 archive entries. Auto backups run only while the app is open. Last valid and pinned vault copies are protected. Full native payload includes archived desktop references and source documents. Candidate state publishes only after saved:true.

- [x] R01 Strict ZIP path/CRC/central-directory/size/manifest coverage; archive inspection and isolated source validation with exact file digest.
- [x] R02 Native vault: chooser-bound destination, recoverable config/index, full payload gather, verified staged write/readback, pin/retention, visible failure; browser history uses selected FS handle and app-owned subdirectory.
- [x] R03 Native payload staging with unique immutable paths and durable GC leases; independent archive inspection never writes data.
- [x] R04 Pure selective planner: note/folder/project/desktop, copy default, explicit replacement, dependency/ID remapping, comparison and unrelated-data preservation.
- [x] R05 UI: selected ZIP/.zeterbak, result/comparison/target/mode, history configuration/list/pin/read/test and manual run; shared operation guard and meaningful failure/cancel.
- [x] R06 Apply: live editor sync, stale-preview guard, safety point, primary transaction, native stage, revalidate, ACK then publish; failed save leaves live state intact.
- [x] R07 Tests: hostile archives, missing payload, incorrect password, read/write failures, pin/retention/quota, aliases/dependencies/collisions, native stage+GC, browser UI narrow/large-text, scheduler/no retry storm; independent review and verifier.
- [x] R08 Register modules/packaging/owners; update help/contracts/README/version/cache and one timestamped CHANGELOG; generated docs and full strict-check.

Ownership: parent JS archive/workflow/UI/app registration/docs; native_vault security_backup.py + focused run_zeter_os.py + native smoke; selective_planner security-restore-utils.js + pure smoke. Read-only safety and owner mapping completed before implementation. No overlapping writers.

Verification boundary: synthetic data only. Browser UI covers wrong/correct encrypted password, readonly inspection, comparison, primary refusal, retry and reload; loaded comparison also fits 560/304 px. Resizing persists window sessions and correctly invalidates the previous state fingerprint; the test explicitly compares again before its write-refusal oracle. Native smoke covers 14 scenarios; the independent verifier confirmed six focused smoke commands. Original review findings (unindexed publication growth and automation references) are closed with failure/recovery oracles. Real folder picker, browser filesystem permissions, physical drive failures and installed EXE remain NOT VERIFIED. No build, commit or deployment.

Final full strict-check: 155 OK, 0 warnings, 0 failures (`work/security-recovery-strict-final-2.log`). The first run (`work/security-recovery-strict-final.log`) retained two failures: missing new module in the synthetic release fixture and static bridge extraction missing the nativeCall adapter name. Both causes were corrected and focused checks passed before the full rerun. Generated docs --check and git diff --check passed. Version 4.0.56, cache security-recovery-1.
