# ClaimGuard testing

All results below were observed on the runs recorded in [`test_results.txt`](test_results.txt)
(raw, unedited output). Nothing here is estimated.

| Suite | What it covers | Result |
|---|---|---|
| Database tests (`database/tests/claimguard_tests_v4.py`) | Constraints, triggers, state machine, procedures, migrations 001–005 (incl. database roles), pgvector/HNSW | **162 / 162 passed**, 0 failed |
| API tests (`backend/tests/api.test.mjs`) | Sign-in, role and ownership checks, full claim workflow over HTTP | **23 / 23 passed**, 0 failed (17.3 s) |
| Semantic sanity check (`embedding-service/scripts/calibrate_thresholds.py`) | HIGH flag on 8 fraud-like and 8 ordinary synthetic claims (AC-15) | see below |
| `npm run typecheck`, `npm run build` | TypeScript and production build of `backend/` | both exit 0 |

## Environment

- PostgreSQL 16.15 with pgvector, Docker image `pgvector/pgvector:pg16`; a fresh disposable database per suite.
- Embedding service: `sentence-transformers/all-MiniLM-L6-v2` (`normalized-v1`, 384 dimensions) on CPU.
- Next.js 16.4.3 dev server, Node.js 22, Python 3.13, Windows 11.
- The API suite ran with the web app connected as `claimguard_web`, a login role in `claimguard_app`
  (migration 005: no DELETE on business tables, no TRUNCATE, no DDL). The database suite connects as the owner
  and switches to the limited roles with `SET LOCAL ROLE` for the privilege checks.

## How to run

Database tests (the runner drops and recreates the named database, then applies schema v4 and
migrations 001–005; add `--no-migrations` to test the base schema only):

```powershell
cd database/tests
py -3.13 -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt
$env:PGHOST='127.0.0.1'; $env:PGPORT='5432'; $env:PGUSER='postgres'; $env:PGPASSWORD='<local password>'
.venv\Scripts\python claimguard_tests_v4.py claimguard_test_yourname
```

The runner needs `psql`, `createdb` and `dropdb` on `PATH`. It exits with code 1 if any check fails.

API tests (they change data: use a freshly built database with the full apply order, the embedding
service and the Next.js server running):

```powershell
cd backend
$env:API_BASE_URL='http://127.0.0.1:3000'; npm run test:api
```

## Semantic sanity check (AC-15)

Each probe is compared with the 18 reference cases; the top cosine similarity is shown. Active rule
`v2.0-minilm`: HIGH ≥ 0.65, MEDIUM ≥ 0.55.

| Probe set | Size | Top similarity range (mean) | Flagged HIGH | Flagged MEDIUM |
|---|---|---|---|---|
| Fraud-like paraphrases | 8 | 0.573–0.812 (0.691) | 6 | 2 |
| Ordinary claims (same domains) | 8 | 0.374–0.573 (0.431) | 0 | 1 |

For the HIGH flag on this sample: precision = 6/6 = 1.00, recall = 6/8 = 0.75.
**Limitation:** the thresholds were chosen by looking at this same sample, so these figures are
optimistic. Sixteen hand-written synthetic sentences are a sanity check, not an evaluation of real-world
fraud detection. High similarity is not proof of fraud, and no match is not proof of legitimacy.

## HNSW index measurement (NFR-06)

From the database suite (3000 uniform-random 384-dimension vectors, 30 random queries): ef_search=40 -> 0.71; ef_search=200 -> 1.00.
The figure for `ef_search=40` varied between 0.67 and 0.71 across our runs, because the 3000 vectors are drawn with
SQL `random()`. The top-k query plan uses `ix_ref_case_embedding_hnsw`. Random vectors are a worst case for HNSW;
real sentence embeddings cluster, but recall was not measured on them.

## API tests

| # | Test | Requirement | Result |
|---|---|---|---|
| 01 | each demo role signs in and /api/auth/me returns its role | FR-01 | PASS |
| 02 | wrong password and deactivated user get the same 401 | FR-01, NFR-01 | PASS |
| 03 | no session: API returns 401, pages redirect to /login | FR-02 | PASS |
| 04 | policyholder cannot read another policyholder's claim (404, nothing revealed) | FR-02, FR-04, BR-01, AC-03 | PASS |
| 05 | policyholder cannot claim against someone else's policy (403) | FR-02, FR-03, BR-01 | PASS |
| 06 | policyholder is refused staff APIs (403) | FR-02 | PASS |
| 07 | adjuster is refused admin APIs (403) and admin pages (redirect) | FR-02 | PASS |
| 08 | admin cannot record a review (only claims adjusters decide) | FR-02 (Admin does not decide) | PASS |
| 09 | invalid claims are rejected with readable messages | FR-15, AC-02 | PASS |
| 10 | policyholder submits a paraphrased fraud pattern; response hides the risk result | FR-03, FR-05, AC-01 | PASS |
| 11 | adjuster sees MATCHES_FOUND, HIGH risk, review_required and the matching pattern ranked first | FR-06, FR-07, FR-16, AC-04, AC-10 | PASS |
| 12 | policyholder's view of the same claim has no fraud evidence | FR-04, BR-01 | PASS |
| 13 | an unrelated claim scores low | FR-06, FR-07 | PASS |
| 14 | /api/similar ranks the matching pattern first for an ad-hoc description | FR-06, BR-05 | PASS |
| 15 | approving the HIGH-risk claim straight away is blocked by the database | FR-09, BR-08, AC-06 | PASS |
| 16 | adjuster requests information; claim waits for the policyholder | FR-08 | PASS |
| 17 | approval is still blocked while the request is unanswered | FR-09, AC-06 | PASS |
| 18 | another policyholder cannot answer the request | FR-18, BR-01 | PASS |
| 19 | the claimant answers once; the claim returns to UNDER_REVIEW; a second answer is refused | FR-18, AC-12 | PASS |
| 20 | approval now succeeds; the decision is final | FR-08, AC-07, BR-11 | PASS |
| 21 | policyholder reads and dismisses own notifications; another user cannot touch them | FR-19, AC-13 | PASS |
| 22 | admin issues a policy; duplicate number and non-policyholder holder are refused | FR-17 | PASS |
| 23 | deactivating a user revokes their live session; reactivation restores sign-in | FR-01, FR-02, NFR-01 | PASS |

## Database tests

### claims / domain constraints

Requirements: FR-03, FR-15, BR-02, BR-03, AC-01, AC-02

| Test | Result |
|---|---|
| AC-01 valid claim stored as SUBMITTED/PENDING | PASS |
| AC-02 negative amount rejected | PASS |
| AC-02 zero amount rejected | PASS |
| AC-02 unknown policy rejected | PASS |
| BR-01 claimant must be policy holder | PASS |
| blank description rejected | PASS |
| inactive policy rejected | PASS |
| incident before policy start rejected | PASS |
| future incident date rejected | PASS |
| claim inserted as DECIDED rejected | PASS |
| claim inserted with COMPLETED screening rejected | PASS |

### claim state machine

Requirements: FR-15, BR-10, BR-11

| Test | Result |
|---|---|
| claim content immutable (amount update) | PASS |
| direct screening_status update rejected | PASS |
| direct claim_status=DECIDED rejected | PASS |
| SUBMITTED -> UNDER_REVIEW allowed | PASS |
| UNDER_REVIEW -> SUBMITTED rejected | PASS |

### roles and users

Requirements: FR-02, FR-17, BR-01

| Test | Result |
|---|---|
| policy held by adjuster rejected | PASS |
| review by policyholder rejected | PASS |
| review by inactive adjuster rejected | PASS |
| reference case by adjuster rejected | PASS |
| role change of user with policies rejected | PASS |
| duplicate email (case-insensitive) rejected | PASS |
| blank password_hash rejected | PASS |

### embeddings / vectors

Requirements: BR-04, NFR-02

| Test | Result |
|---|---|
| zero vector reference case rejected | PASS |
| wrong-dimension vector rejected | PASS |
| embedding_model dimension != 384 rejected | PASS |

### screening

Requirements: FR-06, FR-07, FR-14, BR-07, AC-04, AC-05

| Test | Result |
|---|---|
| FAILED assessment with risk_indicator rejected (AC-05) | PASS |
| FAILED assessment with outcome rejected | PASS |
| FAILED assessment without failure_reason rejected | PASS |
| COMPLETED assessment without risk_indicator rejected | PASS |
| COMPLETED assessment with zero vector rejected | PASS |
| failed attempt sets claim.screening_status=FAILED (not low risk) | PASS |
| duplicate attempt_no rejected | PASS |
| retry after failure: COMPLETED attempt 2 with ranked matches | PASS |
| AC-04 explicit NO_MATCH completed state | PASS |
| NO_MATCH assessment with a match rejected | PASS |
| MATCHES_FOUND with zero matches rejected at commit | PASS |
| rank gap (1,3) rejected at commit | PASS |
| match_rank > top_k rejected | PASS |
| same reference case twice in one assessment rejected | PASS |
| duplicate rank rejected | PASS |
| cross-model match (model-2 case vs model-1 assessment) rejected | PASS |
| match with mismatched case model rejected | PASS |
| BR-02 deactivated reference case cannot be matched | PASS |
| BR-02 unconfirmed reference case cannot be matched | PASS |
| match added in a later transaction rejected | PASS |
| new attempt after COMPLETED screening rejected | PASS |

### review / approval guard / decision

Requirements: FR-08, FR-09, FR-14, AC-06, AC-07

| Test | Result |
|---|---|
| AC-06 APPROVED review while screening PENDING rejected | PASS |
| AC-06 APPROVED review while screening FAILED rejected | PASS |
| APPROVED review citing the FAILED attempt rejected | PASS |
| APPROVED review without assessment rejected | PASS |
| review citing another claim's assessment rejected | PASS |
| blank review notes rejected | PASS |
| REJECTED/INFO_REQUESTED review allowed while screening pending (documented A9) | PASS |
| decision not mirroring review action rejected | PASS |
| failed approval aborts whole transaction | PASS |
| no partial review row left after rolled-back transaction | PASS |
| AC-07 valid approval: review+decision+audit commit, claim DECIDED | PASS |
| (same, re-read from a new session: committed) | PASS |
| second decision on decided claim rejected | PASS |
| review on decided claim rejected | PASS |
| screening attempt on decided claim rejected | PASS |
| decided claim cannot be reverted | PASS |
| decided claim review_required immutable | PASS |
| rejection of a FAILED-screening claim keeps screening_status FAILED | PASS |

### append-only / no-delete

Requirements: FR-10, FR-13, NFR-02, NFR-09

| Test | Result |
|---|---|
| audit_log: UPDATE rejected | PASS |
| audit_log: DELETE rejected | PASS |
| audit_log: TRUNCATE CASCADE rejected | PASS |
| screening_assessment: UPDATE rejected | PASS |
| screening_assessment: DELETE rejected | PASS |
| screening_assessment: TRUNCATE CASCADE rejected | PASS |
| screening_match: UPDATE rejected | PASS |
| screening_match: DELETE rejected | PASS |
| screening_match: TRUNCATE CASCADE rejected | PASS |
| review: UPDATE rejected | PASS |
| review: DELETE rejected | PASS |
| review: TRUNCATE CASCADE rejected | PASS |
| claim_decision: UPDATE rejected | PASS |
| claim_decision: DELETE rejected | PASS |
| claim_decision: TRUNCATE CASCADE rejected | PASS |
| app_user: DELETE rejected | PASS |
| app_user: TRUNCATE CASCADE rejected | PASS |
| policy: DELETE rejected | PASS |
| policy: TRUNCATE CASCADE rejected | PASS |
| claim: DELETE rejected | PASS |
| claim: TRUNCATE CASCADE rejected | PASS |
| reference_fraud_case: DELETE rejected | PASS |
| reference_fraud_case: TRUNCATE CASCADE rejected | PASS |
| audit_log: plain TRUNCATE rejected | PASS |
| screening_match: plain TRUNCATE rejected | PASS |
| claim_decision: plain TRUNCATE rejected | PASS |
| TRUNCATE app_role CASCADE cannot wipe history | PASS |

### reference-case lifecycle

Requirements: FR-11, BR-04

| Test | Result |
|---|---|
| adjuster cannot deactivate a reference case | PASS |
| deactivation without actor rejected | PASS |
| reference-case embedding immutable | PASS |
| reactivation rejected | PASS |
| deactivation record cannot be rewritten | PASS |
| admin deactivation allowed | PASS |

### audit log constraints

Requirements: FR-10, NFR-09

| Test | Result |
|---|---|
| audit: two targets rejected | PASS |
| audit: no target rejected | PASS |
| audit: action/target mismatch rejected | PASS |
| audit: USER without actor rejected | PASS |
| audit: SYSTEM with actor rejected | PASS |
| audit: unknown action rejected | PASS |
| audit: assessment of a different claim rejected | PASS |
| audit: assessment without claim rejected | PASS |
| assessment insert automatically writes exactly one screening audit event | PASS |
| duplicate SCREENING_COMPLETED for same attempt rejected | PASS |
| audit: several REVIEW_RECORDED rows may cite one assessment | PASS |
| audit: reference-case and user events accepted | PASS |

### views

Requirements: FR-12

| Test | Result |
|---|---|
| queue shows failed attempt with NULL risk; no decided rows; summary total = claim count | PASS |

### HNSW / pgvector

Requirements: NFR-06

| Test | Result |
|---|---|
| top-k query uses ix_ref_case_embedding_hnsw at ~3000 rows | PASS |
| HNSW top-k returns k=5 rows for all 30 queries | PASS |

### SRS v2.0 extensions (risk rules, responses, notifications, search, reports)

Requirements: FR-07, FR-19, FR-20, FR-21

| Test | Result |
|---|---|
| versioned rule, notification soft dismissal and analytics/search views are queryable | PASS |
| notification content cannot be rewritten | PASS |
| notification cannot be deleted | PASS |
| information response with blank body is rejected | PASS |

### migration 002: risk-rule foreign key

Requirements: FR-07, BR-06

| Test | Result |
|---|---|
| FK: assessment citing an unknown risk_rule version rejected | PASS |
| FK: a risk_rule used by an assessment cannot be deleted | PASS |
| FK: a used rule_version cannot be renamed | PASS |

### migration 002: sp_screen_claim

Requirements: FR-05, FR-06, FR-07, FR-14, FR-16, FR-22, BR-13, AC-04, AC-05, AC-10, AC-11

| Test | Result |
|---|---|
| COMPLETED: 3 ranked matches, risk from active rule = fn_compute_claim_risk, HIGH sets review_required, audited | PASS |
| AC-05 service failure stored as FAILED: no outcome, no risk, no rule, no matches (never LOW) | PASS |
| wrong-dimension embedding becomes a FAILED attempt with the error as reason, not LOW | PASS |
| no active risk rule: attempt FAILED and the partial COMPLETED work is rolled back | PASS |
| AC-11 new rule version: new assessment records it, older assessment keeps its version | PASS |
| screening a decided claim rejected | PASS |
| screening a claim that already has a COMPLETED attempt rejected | PASS |
| FR-22 retry after FAILED: next attempt_no, COMPLETED | PASS |

### migration 002: sp_decide_claim atomicity

Requirements: FR-08, FR-09, FR-10, NFR-02, AC-06, AC-07

| Test | Result |
|---|---|
| AC-06 APPROVED with FAILED screening refused by fn_assert_approvable | PASS |
| guard failure leaves no review, decision, notification or audit row (counts unchanged) | PASS |
| REJECTED by an inactive adjuster refused (review role trigger) | PASS |
| the procedure's earlier SUBMITTED->UNDER_REVIEW update was rolled back too | PASS |
| AC-07 REJECTED: review + decision + policyholder notification + audit rows, claim DECIDED | PASS |

### migration 004: HIGH-risk approval and information responses

Requirements: FR-09, FR-18, BR-08, BR-10, AC-06, AC-12

| Test | Result |
|---|---|
| HIGH-risk approval by direct review INSERT is blocked too (trg_review_guard) | PASS |
| HIGH-risk APPROVED before any information request refused | PASS |
| INFO_REQUESTED: claim AWAITING_INFO, policyholder notified, no decision | PASS |
| HIGH-risk APPROVED while the request is unanswered refused | PASS |
| another policyholder cannot answer the request | PASS |
| answering a review that is not this claim's latest open request refused | PASS |
| AC-12 policyholder answers: claim AWAITING_INFO -> UNDER_REVIEW, adjuster notified, audited | PASS |
| answering the same request twice refused | PASS |
| HIGH-risk APPROVED after the answer is accepted | PASS |

### migration 003: reference-case versioning

Requirements: FR-11, FR-13, BR-04

| Test | Result |
|---|---|
| revision deactivates the old row and inserts a linked active version, both audited | PASS |
| second revision: WITH RECURSIVE walks newest -> oldest, exactly one version active | PASS |
| revising an inactive (superseded) version refused | PASS |
| revision by a claims adjuster refused (deactivator must be ADMIN) | PASS |
| supersedes_case_id is immutable | PASS |
| a new version cannot supersede a still-active case | PASS |
| two versions cannot supersede the same case | PASS |

### migrations 001/004: users and sessions

Requirements: FR-01, FR-02, NFR-01

| Test | Result |
|---|---|
| the last active admin cannot be deactivated | PASS |
| with a second active admin, deactivating one admin is allowed | PASS |
| deactivation revokes live sessions (trigger) and audits USER_STATUS_CHANGED with the admin as actor | PASS |
| a session cannot be issued to an inactive user | PASS |
| DML DELETE: expired and revoked sessions are deleted, the live one is kept | PASS |

### migration 005: database roles and privileges

Requirements: FR-02, NFR-01 (database-level RBAC)

| Test | Result |
|---|---|
| claimguard_app cannot DELETE claims (no DELETE privilege, before any trigger) | PASS |
| claimguard_app cannot TRUNCATE | PASS |
| claimguard_app cannot UPDATE the audit log | PASS |
| claimguard_app cannot change the schema | PASS |
| claimguard_app can run the whole workflow: insert, CALL both procedures, triggers write audit | PASS |
| claimguard_readonly can read the reporting views | PASS |
| claimguard_readonly cannot read base tables | PASS |
| claimguard_readonly cannot CALL procedures | PASS |

## Bugs found by these tests and fixed

- The database test runner defaulted to a schema path that does not exist and never applied migrations; it now
  uses `database/schema/claimguard_schema_v4.sql`, applies migrations 001–004, and exits non-zero on failure.
- `POST /api/claims` accepted impossible dates such as `2026-02-30` (JavaScript rolls them over to March); it now
  uses a strict date check.
- Buttons with a coloured background rendered invisible: an unlayered `button { background: none }` reset in
  `globals.css` overrode Tailwind utility classes. The resets now live in `@layer base`.
- The staff dashboard labelled a FAILED screening as "Pending"; it now says "Screening failed" (BR-13).

## Not covered

- No browser end-to-end test suite; the UI was checked through the screenshot script (`scripts/screenshots.mjs`).
- No load or concurrency tests beyond the row locks exercised by the procedures.
- The API suite needs a freshly built database each run (it issues a fixed policy number).
