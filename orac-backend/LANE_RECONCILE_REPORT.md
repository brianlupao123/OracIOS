# ORAC backend lane reconciliation

Date: 2026-11-09. Scope: read-only reconciliation of backend `main` only. Repository: `C:\Users\BRIAN LUPAO\Desktop\ffims-asset-register\two-concept-packet-backend-20261005-235259`. HEAD `edbd4bd3d2d6a1810fe5f8039347c22ec917dc7a`. Initial `git status --short`: `?? HANDOVER_STATE.md` (Antigravity handover, preserved). No branch change, source edit, commit, push, server start or production access.

## Agreement section 5

**AGREED**, subject to these corrections: the `edbd4bd` Sales portfolio fix was authored by Codex in a prior turn and committed by Antigravity; `main` is now fast-forwarded locally. The external lane brief is older than the current code: invoice-ready parity and settlement exist, `src/middleware/validate.js` still reads `error.errors`, `.gitattributes` was added before the proposed F5 order, and `data/staging_mapping.json` remains tracked. My first task is this backend-only read-only reconciliation. I will not start an implementation lane until the stated go-ahead.

## Lane 0 raw backend test result

Command: `npm test` (`node --test tests/*.test.js`) on the above HEAD. First sandbox run produced loopback `EACCES` and is invalid as a code result. Re-run with local loopback access exited 0:

```text
ℹ tests 1411
ℹ suites 17
ℹ pass 1407
ℹ fail 0
ℹ cancelled 0
ℹ skipped 4
ℹ todo 0
ℹ duration_ms 76328.5803
```

The frontend half of Lane 0 is outside this backend-only instruction. `npm ci` and the snapshot script were not run; `npm ci` would mutate dependencies and the snapshot creates an archive outside the two permitted reports.

## Reconciliation

`DONE` means the requested backend behavior has direct evidence; `PARTIAL` means some code exists but the lane gate is not complete. Frontend-only lanes are marked `NOT-APPLICABLE` to this backend-only scan, not accepted.

| Lane | Status | Evidence and remaining gate |
|---|---|---|
| 0 backend | PARTIAL | Suite above passes. No clean-tree claim: handover untracked. No `npm ci` or snapshot run. |
| A importer | TODO | `src/router.js:129-130` has an existing lead import, but the proposed master-data importer routes and `import_jobs` are absent. The patch is unapplied; Antigravity owns it. `src/router.js`, `src/store.js`, `src/controllers/adminController.js` are reserved. |
| B E2E audit | PARTIAL | `tests/endToEndIndustrialWorkflowAudit.test.js:159-168,330-381` exercises real PO and invoice handlers; `:34-45,273` still uses a test-local supervisor-custody fixture helper. The brief's strict no-hand-status-write criterion is not fully met. |
| C validation | TODO | `src/middleware/validate.js:7-8` reads `error.errors`; Zod 4 field issues use `error.issues`. No focused response test found. |
| D bulk timesheet matching | NOT-APPLICABLE | Frontend-only lane; not inspected under backend-only instruction. |
| E Pastel | PARTIAL | `src/payroll.js:32,61,159-166` computes payroll hours and emits a proposed CSV header; `src/controllers/reportsController.js:82-113` exports and audits. A real accepted Sage sample and golden-file comparison are not evidenced. Header compatibility remains unverified. |
| F1 tracked data hygiene | PARTIAL | `git ls-files data` returns `data/staging_mapping.json`; `data/db.json` is excluded by `.gitignore:2`. Tracked staging mapping needs owner-safe inspection/remediation. |
| F2 release archives | TODO | No `git archive` release artifact or exclusion proof reviewed. |
| F3 privacy scan | TODO | No complete case-insensitive archive scan reviewed; `src/store.js:70-71` still has real client names. |
| F4 real client names | PARTIAL | `src/store.js:70-71` names Zimplats and Mimosa. Owner decision pending; no rename made. |
| F5 line endings | PARTIAL | `.gitattributes:1` is `* text=auto`, introduced in `21da247` before Lane A. No isolated final normalization or post-normalization importer hash proof. |
| H1 advisories | TODO | `npm audit` not run in this read-only reconciliation; no dependency update. |
| H2 clock tests | TODO | No three-timezone or simulated-date suite in this scan. |
| H3 currency | PARTIAL | USD exists in commercial code, but shared display formatting is frontend-owned and owner/accountant confirmation is pending. No format change made. |
| I pilot readiness | PARTIAL | `scripts/pilot-fixture/` and `scripts/lib/restoreStoreBackup.js:1-13` exist. Disposable database backup/restore, offline reconnect, two-device and accountant checks not demonstrated here. |

## Conflicts to resolve before implementation

1. Lane A patch hashes were reported to differ on `adminController.js` and `router.js` at this base; do not bypass the patch gate. Antigravity reported backend `git apply --check` fails on CRLF and `--ignore-whitespace --check` succeeds, but this is not authorization to apply.
2. The handover's blanket “working tree clean” claim is inaccurate: `HANDOVER_STATE.md` is untracked.
3. The external CHAT_05 packet is dated before Phase 5 settlement and before the shared invoice readiness gate; see `CHAT05_SCAN_REPORT.md` for exact stale claims.
4. `src/controllers/reportsController.js:94-97` includes employee names in an export-block error; this conflicts with the master brief's instruction that errors use IDs, not names. It does not demonstrate a wage-rate leak, but it needs a separate scoped fix later.
5. The proposed F5 order is already breached by commit `21da247`; future byte-exact importer comparisons must use current hashes.

No implementation lane began in this reconciliation.

## Subsequent local implementation (after the read-only snapshot)

The owner subsequently directed Codex to integrate verified backend work. This section records later changes; it does not alter the point-in-time reconciliation above.

| Lane | Local commit on `main` | Verification |
|---|---|---|
| C | `6d57d0a` | Focused Zod 4 test failed on the old middleware, then 2/2 passed after the fix. Full backend suite: 1,413 tests; 1,409 passed, 0 failed, 4 skipped. |
| F1 | `9ab3092` | `data/staging_mapping.json` removed from Git tracking and added to `.gitignore`. The exact original bytes were restored locally after fast-forward: `git hash-object` matched parent blob `752cef79e91f0bf937dc72fcb907e017fa850c17`. `git check-ignore -v` confirms the local file is ignored. |

Neither commit was pushed or deployed. The three handover reports remain untracked. F1 changed Git tracking only; no application code was edited for that lane.

### H2 timezone sweep on `main` at `9ab3092`

Each command ran the complete suite with the listed `TZ` in a separate PowerShell process and exited 0. The local HTTP tests had loopback access.

| Timezone | Tests | Passed | Failed | Skipped | Duration |
|---|---:|---:|---:|---:|---:|
| `UTC` | 1,413 | 1,409 | 0 | 4 | 54,149.6913 ms |
| `Africa/Harare` | 1,413 | 1,409 | 0 | 4 | 80,613.6732 ms |
| `Pacific/Kiritimati` | 1,413 | 1,409 | 0 | 4 | 90,699.3777 ms |

No test result changed with timezone in this sweep. Month-end, year-end and leap-day clock simulations were not run; H2 remains partial until those checks or a justified clock-injection audit are complete.

### F2/F3 backend archive preflight on `main` at `a0b4f52`

F2 local commit `a0b4f52` added `scripts/create-backend-release-archive.ps1`. A temporary `git archive` from `HEAD` contained 118 entries and passed the script's path exclusions for `.env*`, `data/`, logs, backups, `.git`, `node_modules` and `.orac-ssr-*`. The temporary archive SHA-256 was `C91EFD1A27143E9FF94E6C234A229D39895A193AEEE682F17890E77A6BB669B5`; it was deleted after inspection. This is a backend runtime/deployment allowlist archive, not a production release or a frontend archive.

F3 content scan of that archive for the known real client names, a personal name and Windows workstation paths found **20 known-client-name hits**: `src/curatedDemoData.js` (12), `src/services/entityHierarchy.js` (1), `src/store.js` (7). No workstation-path or personal-name hits were found by those limited patterns. This is **not** a complete secret/PII scan. The backend archive is **not release-ready** until the F4 owner decision on real client names and a broader F3 scan. No names or credential values were printed by the scan; only file, line and pattern category.

### Owner decision and H1 advisory preflight

The owner subsequently selected **replace demo client names with fictional names**. F4 is now authorized as a business decision, but `src/store.js` remains reserved for Lane A; the rename must follow importer reconciliation to avoid a file collision. No rename has been applied yet.

Read-only `npm audit --json` against the current lockfile returned exit 1 and `4` advisories: `proxy-addr` critical (locked 2.0.7), `body-parser` high (2.3.0), `zod` high (4.5.4), and `qs` moderate (6.16.0). The advisory output marks fixes available. `package-lock.json` confirms Express 5.2.1 and the listed dependency versions. No dependency or lockfile update was made; proposed updates need a separate compatibility test and owner review.

### F3 repeatable scan on `main` at `96be507`

Local commit `96be507` added `scripts/scan-backend-release-archive.ps1`. It reads every file entry in a ZIP as UTF-8, checks known client and personal names, Windows workstation paths, private-key headers, credential-bearing PostgreSQL URLs, and common access-token shapes, and prints only file, line and category. On the current `git archive`, it scanned 112 files, found 20 known-client-name occurrences and exited 1. On a one-file clean fictional ZIP, it found 0 and exited 0. Both temporary ZIPs were deleted. The configured patterns do not prove the absence of all PII or secrets; the current archive remains blocked until the owner-approved fictional rename and broader review.

### H1 compatible dependency fixes on `main` at `f41bf23`

Local commit `f41bf23` updates `package-lock.json` only. `npm audit fix` advanced `body-parser` 2.3.0 -> 2.4.0, `proxy-addr` 2.0.7 -> 2.0.8, `qs` 6.16.0 -> 6.17.1, and `zod` 4.5.4 -> 4.6.7 within the existing manifest ranges. A fresh `npm audit --json` exited 0 with `0` vulnerabilities across all severities. The complete backend suite on these locked versions returned 1,413 tests, 1,409 passed, 0 failed and 4 skipped (69,624.5908 ms). No source or manifest change, push or deployment occurred.
