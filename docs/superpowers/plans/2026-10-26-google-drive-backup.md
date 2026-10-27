# Google Drive synchronization — implementation and acceptance

Current accepted user scope: every user connects their own Google Drive. Windows and phone/PWA automatically exchange the current ZeTer OS state and internal files in both directions. Drive contains an ordinary `data` directory, not ZIP archives. Only new or changed bytes are uploaded. Shortcut records are included; external shortcut targets are never read. Before enabling synchronization the user must read its rules and acknowledge them. Concurrent/offline changes preserve both branches and require an explicit in-product choice. No Git publication, EXE installation, remote deletion or paid subscription is authorized by this task.

## Design

Reuse `buildFullSecurityBackup()` only as a local collection/verification adapter. Never upload the ZIP. New cloud objects are immutable ordinary files; existing unchanged payload is reused by ID and SHA-256. The ordinary `data` tree is reconciled only after the D1 head CAS accepts a snapshot. Old bytes move to a service history, preserving recoverable snapshots. Drive folder changes are not atomic; the immutable manifest and accepted head are authoritative. Existing size limits remain explicit; larger data fails visibly rather than creating an incomplete copy.

Windows: system browser OAuth Desktop PKCE/loopback; DPAPI CurrentUser tokens outside exported state. Web: Cloudflare Worker/D1 broker with encrypted refresh tokens, required for automatic sync coordination. The browser stores its opaque session credential in dedicated IndexedDB, never in exported state; access tokens stay in memory. The broker stores account-bound head metadata but never carries file contents. The native session verifies Google token audience, authorized client, scope and expiry before Drive identity. Deployment and credential grants require the concrete Cloudflare/Google setup to be agreed with the user.

Closed applications cannot exchange fresh local changes. Startup/foreground/online and bounded polling use one serialized sync controller. Offline, expired and failed operations remain visible. An automatic pull requires a clean local baseline and no active editor drafts; application uses a safety point, staged payload and primary ACK before publication. Browser immutable Blob storage retains Windows files for the return trip. Baseline local hash is measured after path remapping. Disconnect is local to this connection, not project-wide Google consent revocation.

## Ownership and interfaces

- Native writer: `google_drive_backup.py`, `google_drive_sync.py`, thin `run_zeter_os.py` bridge, native synthetic smoke.
- Frontend writer: OAuth transport, shared sync engine, private browser payload store, full apply, app wiring, security UI, CSS/help and JS/UI smokes.
- Broker writer: `cloud/google-drive-broker/` only.
- Root: Google/Cloudflare setup, public configuration, packaging/manifest registration, canonical docs/version/cache and verification.

Native bridge: OAuth `google_drive_status/connect/disconnect`; generic `google_drive_make_folder/files/put_file/read_file/move_file`; coordinator `google_drive_sync_head/sync_commit`. Immutable file upload accepts `{parentId,name,base64,mimeType,kind,pathKey?,operationId}`. Read accepts `{id,sha256,sizeBytes}`; only a snapshot manifest may omit size, deriving it from bounded owned metadata. Expected CAS conflict returns `{ok:true,conflict:true,head,generation}`. Tokens never cross the native bridge.

Broker: `GET /oauth/start?origin&nonce`, `GET /oauth/callback`, `POST /token`, `POST /disconnect`, `POST /native/session`, `GET /sync/head`, `POST /sync/commit`, `GET /health`. Callback posts `{type:'zeter-google-drive-auth',nonce,sessionHandle}` to the exact allowed app origin. Caller verifies origin, popup identity and nonce. Token response is `{accessToken,expiresAt}` in milliseconds. Bearer handles have a fixed absolute lifetime. CORS uses an exact allowlist. Account identity comes from Google, never from an untrusted submitted account key. Idempotent commit receipts do not replace a fresh read of the canonical head before reconciliation.

## Acceptance and evidence

| ID | Requirement | Evidence |
|---|---|---|
| R01 | Existing state and internal files retained; shortcut targets excluded | Native collection fixture with external sentinel |
| R02 | Individual OAuth connection and expiry/refresh handled | Fake auth/network tests; real account remains a separate check |
| R03 | Ordinary data folder, incremental immutable upload, dedupe, readback verification | Unchanged zero byte uploads; note-only change; old bytes remain after failed update |
| R04 | Windows→phone→Windows, clean startup pull and primary ACK | Two instances, browser payload roundtrip and real full-apply fixture |
| R05 | Scheduler and disconnect do not publish stale results | Expiry, cancellation, disconnect/refresh race tests |
| R06 | PWA refresh secrets remain server-side | Broker tests, source review, separate live popup test |
| R07 | Responsive usable security panel | Rendered desktop/narrow viewport check |
| R08 | Build/docs/cache ownership remains consistent | Profile smokes, generated docs, strict checker and diff check |
| R09 | Both-device edits never silently overwrite | CAS loser, first-connect choice, durable conflict branch |
| R10 | Mandatory readable synchronization guide | No enabling before acknowledgement; desktop/narrow UI |

## Verification limits

Synthetic transports do not verify live Google OAuth, the production approval/domain review, Cloudflare D1 semantics, popup/COOP behavior, shared visibility between web/Desktop clients, installed PWA or packaged EXE. Record exact executed results and blockers in the final handoff; do not convert configuration or submitted review into successful public authorization.
