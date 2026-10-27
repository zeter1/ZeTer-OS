# Deleted Drive root recreation

User authorizes automatic creation of a new cloud folder and full upload of current local data after deleting the canonical folder. Keep the existing root and immutable-head owners. Do not restore trash, delete data, reset credentials or create folders on network/auth/foreign-ownership failures.

## Acceptance

- R1: provider head reports `missingRootFolderId` only for verified app-owned root metadata with trashed=true, or confirmed HTTP404 for an accepted head root. A null-head reservation404 may be an ID not created yet and must resume that ID, not recreate. Other errors propagate. Normal active roots do not trigger recreation.
- R2: core durably saves a fresh uploadIntent/baseline reset before recreation mutation, then sends all current local files using a virtual null head and the current monotonic generation. Old accepted head/receipts remain until a complete replacement commits.
- R3: authenticated `/sync/recreate` receives exactly `{expectedGeneration,oldRootFolderId,bootstrap}`. The replacement is atomically reserved once per account/old root/generation in `sync_root_replacements`; simultaneous clients/lost responses reuse the winner. Session/account/generation and old canonical root are checked inside SQL. No cloud bytes or Google credentials in this endpoint.
- R4: bootstrap can return a pending replacement whose root differs from the still-accepted old head, only when its structure matches a recorded replacement receipt for that exact head root/generation. New commit must match canonical reservation. Old late commits and stale recreation must fail CAS. No generation rollback or account-wide history deletion.
- R5: actual Google objects are created only after durable local intent and reservation. After cancellation, no further cloud POST. Ordinary new incoming-data confirmation/conflict protections remain.

## Interface

Provider `head()` adds optional `missingRootFolderId` to its existing result. It reads the root from head, or existing bootstrap reservation when head is null, without allocating objects. Native and web perform the same bounded ownership/trash/404 check.

Provider `recreateRoot({expectedGeneration,oldRootFolderId}) -> {bootstrap,...head/generation/accountKey}` or `{conflict:true,...}` encapsulates candidate allocation, `/sync/recreate` and validation of existing active replacement folders. Native bridge `google_drive_recreate_root(payload)`.

Core on missing root collects the local model, clears incoming/conflict/pending/old uploadIntent and baselines durably, creates a fresh intent, calls recreateRoot, durably attaches returned bootstrap, and publishes with virtual head=null at the same generation. It never uses old manifest files for this full upload. If another replacement already committed, fresh head/CAS wins and normal conflict/confirmation applies.

## Owners

- Root: sync core + sync smoke, help/README/GOOGLE_DRIVE docs, version/cache/changelog/generated integration and deployment.
- Backend writer: broker Worker/schema/additive migration/tests/README only.
- Provider writer: google_drive_sync.py, run_zeter_os.py bridge, google-drive-backup-utils.js, native/runtime tests, NATIVE_BRIDGE/DATA_MODEL sections only.

## Verification

Synthetic deleted head/null-head reservation, all-current-data upload, same root across concurrent/lost replies, missing-vs-network/auth/foreign distinctions, metadata ACK refusal, cancellation, stale generation/account/disconnect, late old commit, preserved old receipts. Independent review and verifier. Real canonical root is currently trashed per metadata evidence; after source/server checks an approved live recreation may materialize its new empty folder structure, but do not publish artificial data as the user's canonical head. User source restart performs actual data upload.
