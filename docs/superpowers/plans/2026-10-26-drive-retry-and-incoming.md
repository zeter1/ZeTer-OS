# Google Drive retry and incoming confirmation implementation plan

**Goal:** one current `ZeTer OS/data`, no duplicate folders/files after interrupted uploads, automatic upload and explicit approval of incoming data on another device.

**Architecture:** keep the existing immutable snapshot/CAS/data-tree owner. Add an authenticated account-bound D1 bootstrap reservation for canonical Drive IDs, a durable local upload intent before Drive mutations, and a transient incoming offer outside synced state.

**Tech stack:** existing Python/pywebview, plain JavaScript, Cloudflare Worker/D1; no new dependencies.

**Scope authority:** user explicitly requires one data folder, incremental new/changed files and incoming notification with confirmation buttons. User confirmed ZeTer OS is CLOSED during repair. Source4.0.91 fixed native zero-argument bridge and removed checkbox; published and strict175/0/0. This is the subsequent4.0.92 repair, no commit/EXE deployment.

## Requirements and evidence

- R01: one canonical root/data/history/staging per authenticated account, including two first devices. D1 primary conditional insert chooses winning IDs before Drive POST; an accepted head remains authoritative. Proposals contain IDs only, no content/tokens.
- R02: persist `uploadIntent` before bootstrap/network mutations. Fix accountKey, operationId, snapshotId, createdAt, expectedGeneration and localHash. Rejected metadata ACK means zero Drive mutations. Preserve legacy ready `pending`.
- R03: allocate stable Drive IDs and persist them before POST, including web files. Lost response + temporarily empty listing + restart must reuse ID. Fixed-ID collisions validate ownership/name/MIME/kind/parent/pathKey/hash/size; never overwrite an unrelated object.
- R04: unchanged files produce zero byte uploads. Visible data has one current file per path after accepted head; previous immutable bytes remain outside the working data tree for recovery.
- R05: normal cloud-only change/empty first attach offers incoming data, `apply=0` before explicit confirmation. Exact buttons: «Загрузить новые данные» and «Позже». No checkbox; automatic uploads remain.
- R06: accept rechecks account/head/local hash; changed head needs a new click, local edits need existing conflict preservation. Editor safety, hash verification, primary ACK and readback remain.
- R07: incoming UI is transient and never touches workspace.notifications or synced state. Same head does not repeatedly pop up; deferred offer remains in notification center/panel, new head can notify again. Disconnect/account switch/stop invalidate callbacks.
- R08: preserve existing five partial roots and all contents. Any later metadata-only recovery organization requires an exact source→target map and current head/ownership evidence. No automatic deletion/merge in retry fix.

## Interface contract

Provider:

```js
allocateId() -> {id}
bootstrap({expectedGeneration}) -> {bootstrap:{rootFolderId,dataFolderId,historyFolderId,stagingFolderId}} | {conflict:true}
makeFolder({id,...existingFields}) // fixed id for canonical folders
putFile({id,...existingFields})    // fixed id before upload
```

Native bridge adds no-argument `google_drive_allocate_id` and one-payload `google_drive_bootstrap`; existing methods stay compatible. Web/native bootstrap checks existing account reservation, otherwise discovers only verified app-owned root/children (deterministic oldest root if no accepted head), generates missing IDs via Google and proposes the complete structure. Worker accepts authenticated POST `/sync/bootstrap`, validates exact shape/IDs/generation, returns the existing atomic winner; generation drift returns409 without mutation.

Core/UI:

```js
options.onIncoming(incomingOrNull)
getIncoming() -> {key,snapshotId,generation,contentHash,text,busy,deferred} | null
acceptIncoming(expectedKey)
deferIncoming(expectedKey)
settings().incoming // same public projection
```

Internal offer retains observed local hash/account/head; never expose tokens/file contents. Stable per-file operation keys derive from account, canonical staging parent, kind, path and SHA; `uploadIntent.fileIds` carries pending IDs across local-hash changes in that account until a successful accepted snapshot. Snapshot operation key and createdAt stay fixed within an intent. Bound/validate the map and fail before mutation if full.

## Owners

- Root writer: `app/js/core/google-drive-sync-utils.js`, `tools/smoke_google_drive_sync.js`, plan, version/cache/CHANGELOG, generated docs/integration, cloud deployment and explicit isolated live tests.
- Provider writer: `google_drive_sync.py`, `google_drive_backup.py` only if needed, `run_zeter_os.py` bridge methods, `app/js/core/google-drive-backup-utils.js` whole file including panel incoming buttons, broker folder/schema/tests/README, native/runtime adapter tests. No app.js/security UI writes.
- UI writer: `app/js/app.js`, `app/js/core/notification-ui-utils.js`, `app/js/core/security-ui-utils.js`, relevant CSS, help/README/docs/GOOGLE_DRIVE.md and UI smoke. No adapter/core-sync writes. Attach transient notification projection through agreed callback.
- Independent verifier after source stabilization; focused safety review for reservation/persistence before live deployment.

## Sequence and tests

1. Provider adds strict bootstrap reservation and fixed-ID protocol; synthetic SQLite/native/web tests prove account isolation, generation drift, concurrent bootstrap and ambiguous POST. Root in parallel implements durable intent and incoming core using the interface above.
2. UI implements blue transient offer/notification-center card and keyboard/busy/defer behavior; adapter owner implements panel actions using core API. No shared writer files.
3. Core failure injection after each bootstrap/file/state/manifest stage, restart and lost response proves stable IDs/counts; metadata refusal has zero cloud writes. Cloud-only/startup/empty attach has no apply before click, stale keys/head/account/local edits block replacement, apply refusal retains retry.
4. Independent verification, strict0warnings/0failures, version4.0.92 + one fresh timestamp block and current help, manifest generation. Preserve all first failures and environment/network limitations.
5. Only reviewed Worker schema/code deployment with existing bindings/secrets and temporary narrow key revoked. Isolated synthetic live check before restarting user app. App-owned root metadata already audited: head absent/generation0, five roots, no file bytes read. Recovery plan for those roots is separate from code correctness.
