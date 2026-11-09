# ClaimGuard — Insurance Claims Processing with Fraud-Pattern Detection

ClaimGuard is a DBMS project (PES University, DBMS Level 3 Experiential Learning) that runs the full
insurance-claim lifecycle on PostgreSQL. Policyholders submit and track claims, adjusters review them,
and administrators manage policies, users and a library of confirmed fraud patterns. Every new claim is
compared by **meaning**, not keywords, with those patterns using sentence embeddings stored in
PostgreSQL through **pgvector**.

> **Advisory only.** Similarity scores and risk levels are evidence for a human adjuster, not proof of
> fraud. ClaimGuard never approves or rejects a claim automatically. A failed or incomplete screening is
> never treated as low risk, and it blocks approval.

**Team:** Hrushikesh Karnam (PES1UG24CS668) · Nishant Hegde (PES1UG24CS681)

## Contents

1. [Problem statement](#problem-statement)
2. [Objectives](#objectives)
3. [Scope](#scope)
4. [Functional requirements](#functional-requirements)
5. [ER diagram](#er-diagram)
6. [Relational schema](#relational-schema)
7. [Database choice and justification](#database-choice-and-justification)
8. [Data dictionary](#data-dictionary)
9. [SQL implementation](#sql-implementation)
10. [Vector implementation](#vector-implementation)
11. [Important queries](#important-queries)
12. [System architecture](#system-architecture)
13. [Setup and run](#setup-and-run)
14. [Demo accounts](#demo-accounts)
15. [Screenshots](#screenshots)
16. [Testing](#testing)
17. [Team and individual contributions](#team-and-individual-contributions)
18. [Known limitations](#known-limitations)
19. [Conclusion and future enhancements](#conclusion-and-future-enhancements)

## Problem statement

Insurers need every claim tracked consistently from submission to decision, with an accountable review
trail. Fraudulent claims often repeat known patterns (a staged collision, an inflated repair invoice, a
phantom hospital stay) in different words, so keyword matching misses them. ClaimGuard combines a
strictly constrained relational model of policies, claims, reviews and decisions with semantic
retrieval of previously confirmed synthetic fraud patterns. An adjuster can then see, for each claim,
which known patterns it resembles and how closely.

## Objectives

- Keep user, role, policy, claim, screening, match, review, decision, notification and audit records consistent.
- Support the whole lifecycle: submission, screening, review, information request and response, and final decision.
- Retrieve semantically similar confirmed reference cases even when the wording differs.
- Compute an explainable, **versioned** advisory risk level and flag HIGH-risk claims for mandatory human review.
- Enforce role and ownership checks on the server, and critical state transitions inside the database.
- Demonstrate relational and advanced DBMS features: keys, constraints, joins, aggregates, subqueries,
  CTEs (including recursive), window functions, views, functions, procedures, triggers, transactions,
  B-tree/GIN/HNSW indexes, full-text search and vector similarity.
- Verify the system with repeatable tests and report only observed results.

## Scope

**In scope:** sign-in and role-based access for Policyholder, Claims Adjuster and Admin; policy
issuance; claim submission against an owned active policy; claim tracking with a status timeline;
embedding generation and top-k vector retrieval; persisted screening attempts, matches and risk; explicit
failure states and manual re-screening; the adjuster queue with filters and full-text search;
approve/reject/request-information; append-only information responses; notifications; reference-case
management with versioning; audit history; operational and analytical reports.

**Out of scope:** real insurers, payments or identity providers; automatic payout, denial or fraud
determination; training a fraud model; real claimant data (all data is synthetic); cloud deployment;
individual adjuster assignment (the queue is shared).

## Functional requirements

Summarised from [`docs/ClaimGuard_FINAL_SRS.pdf`](docs/ClaimGuard_FINAL_SRS.pdf) (SRS v2.0). The
"Implemented in" column points to the main code; [`docs/TESTING.md`](docs/TESTING.md) maps tests to requirements.

| ID | Requirement | Implemented in |
|---|---|---|
| FR-01 | Sign-in with hashed passwords | `api/auth/login`, `lib/auth.ts`, migration 001 (`user_session`) |
| FR-02 | Every server operation checks session, role and ownership | `requireRole` on every route; ownership filtered in SQL; role triggers |
| FR-03 | Submit a claim on an owned active policy with valid date, amount and description | `POST /api/claims`, `trg_claim_insert_guard`, composite ownership FK |
| FR-04 | Policyholders see only their own claims and status | `/my-claims`, `/my-claims/[id]` |
| FR-05 | Commit the claim as SUBMITTED/PENDING, then screen it | `lib/screening.ts` → `CALL sp_screen_claim` |
| FR-06 | Persist ranked top-k matches with cosine similarity and model identity, or NO_MATCH | `screening_match`, `sp_screen_claim` |
| FR-07 | Database procedure computes an advisory risk from evidence and a versioned rule | `sp_screen_claim`, `fn_compute_claim_risk`, `risk_rule` FK |
| FR-08 | Adjuster approves, rejects or requests information | `POST /api/claims/[id]/review` → `CALL sp_decide_claim` |
| FR-09 | Approval blocked for incomplete screening or unresolved HIGH-risk review | `fn_assert_approvable` (schema v4 + migration 004) |
| FR-10 | Audit rows written by triggers in the same transaction | `fn_write_*_audit` triggers |
| FR-11 | Admins add and deactivate reference cases; inactive or unconfirmed ones are not searched | `/admin/reference-cases`, migration 003 versioning |
| FR-12 | Operational reports | `v_claim_status_summary`, `v_review_queue`, `/admin` |
| FR-13 | History cannot be deleted or rewritten | Append-only and no-delete triggers |
| FR-14 | Screening failure stored explicitly, never LOW | FAILED assessment with reason |
| FR-15 | Validation and state integrity | Route validation + CHECK constraints + `trg_claim_state_guard` |
| FR-16 | HIGH risk sets `review_required` via trigger | `trg_high_risk_flag` |
| FR-17 | Admins issue policies, audited | `/admin/policies`, `trg_policy_issuance_audit` |
| FR-18 | Policyholders answer open information requests (append-only) | `information_response` + migration 004 triggers |
| FR-19 | Users read and dismiss only their own notifications | `/notifications`, `PATCH /api/notifications/[id]` |
| FR-20 | Keyword search with relevance ranking | `/adjuster/queue` (GIN + `ts_rank`) |
| FR-21 | Analytical reports | `/admin` (risk over time, pattern frequency, workload, aged HIGH-risk) |
| FR-22 | Retry failed screening; decided claims cannot be re-screened | `POST /api/claims/[id]/rescreen`, `attempt_no` |

## ER diagram

Chen notation. It shows all 15 entities after migrations 001–004, including the `REVISES`
self-relationship that migration 003 added to `REFERENCE_FRAUD_CASE`.

![ClaimGuard ER diagram (Chen notation)](docs/ClaimGuard_ER_Diagram_Chen.png)

Source [SVG](docs/ClaimGuard_ER_Diagram_Chen.svg) · [PDF](docs/ClaimGuard_ER_Diagram_Chen.pdf) ·
notation, relationships and cardinalities: [`docs/ClaimGuard_ER_and_Relational_Schema_v6.md`](docs/ClaimGuard_ER_and_Relational_Schema_v6.md)

## Relational schema

Each row is a relation (underlined = primary key); arrows go from each foreign key to the key it references.

![ClaimGuard relational schema v6](docs/ClaimGuard_Relational_Schema_v6.png)

Source [SVG](docs/ClaimGuard_Relational_Schema_v6.svg) · [PDF](docs/ClaimGuard_Relational_Schema_v6.pdf).
Both diagrams are re-exported from their SVG sources with `node scripts/export_diagrams.mjs`.

## Database choice and justification

**PostgreSQL 16** is the system of record. Claims, policies, decisions and audit history are highly
structured, and their correctness depends on rules: a claim must belong to its policy's holder, a
decision must mirror a review, an audit row must never change. PostgreSQL enforces these rules where
they cannot be bypassed:
- foreign keys (including composite keys) and CHECK constraints
- triggers and PL/pgSQL functions and procedures
- full ACID transactions

It also brings the reporting features this project needs: views, CTEs, window functions and full-text
search with GIN indexes.

**pgvector** adds a `vector(384)` column type, the cosine-distance operator `<=>` and the HNSW
approximate-nearest-neighbour index. That covers the semantic part: comparing free-text incident
descriptions by meaning.

**Why one engine instead of a separate vector database.** A screening attempt writes the claim's
embedding, the ranked matches and the risk level together. In ClaimGuard that is one PostgreSQL
transaction (`sp_screen_claim`):
- the matches can never exist without their assessment, or the reverse
- the HIGH-risk trigger runs in the same commit
- a failure rolls everything back to a recorded FAILED attempt

`screening_match` has real foreign keys to `reference_fraud_case` and `embedding_model`, so the database
itself guarantees that every match points at an existing, same-model, active and confirmed case.

A separate vector store would need cross-system consistency handling, and could not offer those
foreign keys, transactions or triggers. At this data size, pgvector's HNSW index is fast enough
(measured in [`docs/TESTING.md`](docs/TESTING.md)).

## Data dictionary

[`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md) lists every table, column, type, nullability,
default, constraint, index and trigger. These were read from the PostgreSQL catalog of a database built
with the documented apply order, and each column has a description of its meaning. In summary:

| Group | Tables |
|---|---|
| Identity and access | `app_role`, `app_user`, `user_session` |
| Coverage and claims | `policy`, `claim` |
| Vector screening | `embedding_model`, `reference_fraud_case`, `risk_rule`, `screening_assessment`, `screening_match` |
| Review and outcome | `review`, `information_response`, `claim_decision` |
| Communication and history | `notification`, `audit_log` |

## SQL implementation

Database objects after the full apply order (counted from the catalog):

| Tables | Views | Functions | Procedures | Triggers | Indexes | Constraints |
|---|---|---|---|---|---|---|
| 15 | 8 | 37 | 3 | 56 | 62 | 15 PK · 28 FK · 17 UNIQUE · 42 CHECK · 1 deferred constraint trigger |

| Feature | Where | Examples |
|---|---|---|
| **DDL** | [`database/schema/claimguard_schema_v4.sql`](database/schema/claimguard_schema_v4.sql) | `CREATE TABLE` for 14 tables, `CREATE EXTENSION vector`, generated identity keys, `vector(384)` columns |
| **ALTER** | schema v4, migrations [002](database/migrations/002_risk_rule_fk_and_procedure.sql), [003](database/migrations/003_reference_case_versioning.sql) | `ALTER TABLE screening_assessment ADD CONSTRAINT fk_assessment_risk_rule_version …`; `ALTER TABLE reference_fraud_case ADD COLUMN supersedes_case_id …` |
| **DROP** | [`database/scripts/reset_db.sql`](database/scripts/reset_db.sql) | Views, then procedures, child tables before parents, then functions, all without CASCADE; refuses to run on a database whose name doesn't look disposable |
| **Constraints** | schema v4 | Composite FK `claim(policy_id, claimant_id) → policy(policy_id, holder_id)`; CHECKs such as `ck_assessment_failed` (a FAILED attempt carries no risk); partial unique `ux_risk_rule_one_active` |
| **Indexes** | schema v4, migration 003 | B-tree query paths (`ix_claim_queue`); **GIN** `ix_claim_description_fts`, `ix_ref_case_fts`; **HNSW** `ix_ref_case_embedding_hnsw` (cosine, partial: active and confirmed only) |
| **Views** | schema v4, migration 001 | `v_review_queue` (LATERAL latest attempt), `v_claim_status_summary`, `v_risk_distribution_over_time`, `v_reference_match_frequency`, `v_adjuster_workload`, `v_high_risk_aged_queue`, `v_stale_pending_screening`, `v_active_session` |
| **Functions** | schema v4, migrations | `fn_compute_claim_risk`, `fn_assert_approvable`, `fn_session_principal`, `fn_user_has_role`, plus trigger functions |
| **Procedures** | migrations 002, 003 | `sp_screen_claim`, `sp_decide_claim`, `sp_revise_reference_case` |
| **Triggers** | schema v4, migrations 001–004 | State machine, immutability, append-only, role checks, HIGH-risk flag, audit writers, information-response guard, last-admin guard |
| **Transactions** | migrations; app routes; query file §H | Every migration is one `BEGIN … COMMIT`. The app wraps `CALL sp_*` in `BEGIN/COMMIT` with `ROLLBACK` on error. §H shows `ROLLBACK` discarding audit rows. `SELECT … FOR UPDATE` / `FOR SHARE` serialize work on a claim and lock the active rule. |

The complete query collection is [`database/queries/claimguard_queries_v1.sql`](database/queries/claimguard_queries_v1.sql),
with sections A–H covering SELECT, joins, aggregation, subqueries, CTEs, window functions, project
queries and transactions. Its full run is recorded in
[`database/queries/execution_log.txt`](database/queries/execution_log.txt).

## Vector implementation

| Aspect | ClaimGuard |
|---|---|
| What is embedded | The free-text `description` of every claim and every reference fraud case |
| Model | `sentence-transformers/all-MiniLM-L6-v2`, served by [`embedding-service/`](embedding-service/) (FastAPI); recorded as `embedding_model` (`normalized-v1`) |
| Dimension | 384, L2-normalised (unit length, so cosine similarity equals the dot product) |
| Storage | `reference_fraud_case.embedding vector(384)`; the claim's vector is kept with its attempt in `screening_assessment.description_embedding` |
| Metric | Cosine distance `<=>`; stored `similarity_score = 1 − distance` |
| Index | HNSW (`m = 16`, `ef_construction = 64`) on active, confirmed cases only |
| Retrieval | Top-k (default 5, `SCREENING_TOP_K`) nearest cases from the **same** embedding model, inside `sp_screen_claim` |
| Risk | Highest similarity compared with the active `risk_rule`. `v2.0-minilm`: HIGH ≥ 0.65, MEDIUM ≥ 0.55, otherwise LOW. HIGH sets `review_required`. |
| Calibration | `embedding-service/scripts/calibrate_thresholds.py`: on 16 synthetic sentences, fraud-like 0.57–0.81 vs ordinary 0.37–0.57 |
| Failure | No vector (service down), wrong dimension, unregistered model or no active rule: the attempt is stored as FAILED with a reason, never LOW |
| Reference data | 18 synthetic fraud patterns ([`data/reference_cases.json`](embedding-service/data/reference_cases.json)) embedded into [`claimguard_reference_cases_v2.sql`](database/seed/claimguard_reference_cases_v2.sql) |

Reference cases are immutable, because past matches must keep pointing at the exact evidence an
adjuster saw. Editing or re-embedding a case therefore creates a new version
(`sp_revise_reference_case`) and deactivates the old one.

## Important queries

| # | Query | What it shows | Where |
|---|---|---|---|
| 1 | Top-k cosine search | `ORDER BY embedding <=> $query LIMIT k` over active, confirmed, same-model cases, using HNSW | [`002_…sql` (sp_screen_claim)](database/migrations/002_risk_rule_fk_and_procedure.sql), [`lib/similarity.ts`](backend/app/lib/similarity.ts) |
| 2 | Atomic screening | `CALL sp_screen_claim(…)`: assessment, matches, risk and audit in one transaction; errors become FAILED | [`lib/screening.ts`](backend/app/lib/screening.ts) |
| 3 | Atomic decision | `BEGIN; CALL sp_decide_claim(…); COMMIT` (ROLLBACK on error) | [`api/claims/[id]/review/route.ts`](backend/app/api/claims/[id]/review/route.ts) |
| 4 | Ranked keyword search | `to_tsvector(description) @@ websearch_to_tsquery($q)`, ordered by `ts_rank`, highlighted with `ts_headline` (GIN) | [`lib/queue.ts`](backend/app/lib/queue.ts) |
| 5 | Recursive month series | `WITH RECURSIVE` generates every month so months with zero claims still appear | [`claimguard_queries_v1.sql` §E4](database/queries/claimguard_queries_v1.sql) |
| 6 | Version chain | `WITH RECURSIVE` walks `supersedes_case_id` in both directions | [`lib/referenceCases.ts`](backend/app/lib/referenceCases.ts) |
| 7 | Status timeline | One `UNION ALL` over claim, assessments, reviews, responses and decision | [`lib/timeline.ts`](backend/app/lib/timeline.ts) |
| 8 | Correlated subquery | Matches stronger than that reference case's own average similarity | [§D7](database/queries/claimguard_queries_v1.sql) |
| 9 | Window functions | `RANK() OVER (PARTITION BY claimant…)`, running totals, `LAG/LEAD` | [§F1–F7](database/queries/claimguard_queries_v1.sql) |
| 10 | Paged audit trail | `count(*) OVER ()` returns the total and the page in one query | [`admin/audit/page.tsx`](backend/app/admin/audit/page.tsx) |
| 11 | Evidence card | `json_agg(json_build_object(…) ORDER BY match_rank)` per attempt | [`lib/claims.ts`](backend/app/lib/claims.ts) |
| 12 | Rollback proof | `BEGIN; CALL …; ROLLBACK;` shows the audit rows disappear | [§H3](database/queries/claimguard_queries_v1.sql) |

## System architecture

```mermaid
flowchart LR
  B[Browser<br/>policyholder · adjuster · admin] -->|HTTPS, httpOnly session cookie| N
  subgraph N[Next.js app - backend/]
    P[Pages<br/>server components] --> L[lib/: auth, screening,<br/>claims, queue ...]
    R[Route handlers<br/>/api/*] --> L
  end
  L -->|POST /embed| E[Embedding service<br/>FastAPI + all-MiniLM-L6-v2<br/>embedding-service/]
  L -->|node-postgres, parameterised SQL,<br/>CALL sp_screen_claim / sp_decide_claim| D[(PostgreSQL 16 + pgvector<br/>tables · views · procedures · triggers<br/>GIN + HNSW indexes)]
```

- **Next.js** (`backend/`): UI and API in one app. Every page and route checks the session and role in
  the database, and all SQL is parameterised. Database rule violations are shown as plain messages
  (422 for broken rules, 409 for state conflicts).
- **Embedding service** (`embedding-service/`): stateless. It turns text into a 384-dimension vector and never touches the database.
- **PostgreSQL + pgvector**: the system of record. The rules that matter (ownership, state
  transitions, approval guard, append-only history, audit) live in the database, so no application
  path can bypass them.

```text
Insurance-Claims-Processing/
├── backend/                 Next.js 16 app (pages, /api routes, lib/), tests/api.test.mjs
├── embedding-service/       FastAPI embedding service, seed/re-embed/calibration scripts
├── database/
│   ├── schema/              claimguard_schema_v4.sql (base schema)
│   ├── migrations/          001 sessions · 002 FK + procedures · 003 versioning · 004 workflow guards
│   ├── seed/                synthetic data, demo passwords, reference cases v2 (real embeddings)
│   ├── queries/             query collection (A–H), read-only subset, execution log
│   ├── scripts/             reset_db.sql
│   └── tests/               claimguard_tests_v4.py
├── scripts/                 screenshots.mjs, export_diagrams.mjs
└── docs/                    SRS, architecture, diagrams, data dictionary, testing, screenshots
```

## Setup and run

You need PostgreSQL 16 with pgvector, Python 3.13 and Node.js 22. Docker is optional.

### 1. Database

Create an empty database (any name; a disposable one for testing), then apply the files **in this order**:

| # | File | Purpose |
|---|---|---|
| 1 | `database/schema/claimguard_schema_v4.sql` | Tables, constraints, triggers, views |
| 2 | `database/seed/claimguard_seed_v1.sql` | Synthetic users, policies, claims, reviews |
| 3 | `database/migrations/001_user_session_auth.sql` | Sessions and role functions |
| 4 | `database/seed/claimguard_demo_passwords_v1.sql` | Demo passwords for the seed users |
| 5 | `database/migrations/002_risk_rule_fk_and_procedure.sql` | Risk-rule FK, `sp_screen_claim`, `sp_decide_claim` |
| 6 | `database/migrations/003_reference_case_versioning.sql` | Reference-case versions, audit, keyword index |
| 7 | `database/migrations/004_workflow_guards.sql` | Information-response rules, HIGH-risk approval rule, admin guard |
| 8 | `database/seed/claimguard_reference_cases_v2.sql` | 18 reference cases with real embeddings + rule `v2.0-minilm` |

```powershell
psql -v ON_ERROR_STOP=1 -d claimguard_demo -f database/schema/claimguard_schema_v4.sql
# ...repeat for files 2-8 in order
```

Optional:
- `embedding-service/scripts/reembed_reference_cases.py` moves the six original seed cases onto the real model.
- `database/queries/claimguard_queries_v1.sql` runs the full query demonstration (once per fresh database).
- `database/scripts/reset_db.sql` drops everything, but only on a database whose name contains demo, dev, test or scratch.

With Docker instead of a local install:

```powershell
docker run -d --name claimguard-db -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=<choose one> pgvector/pgvector:pg16
cmd /d /c "docker exec -i claimguard-db psql -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo < database\schema\claimguard_schema_v4.sql"
```

### 2. Embedding service

```powershell
cd embedding-service
py -3.13 -m venv .venv
.venv\Scripts\python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python app.py        # http://127.0.0.1:8001, GET /health, POST /embed
```

The first start downloads the model (about 90 MB), and loading takes about 15 s.

### 3. Web application

```powershell
cd backend
npm ci
copy .env.example .env.local       # then edit DATABASE_URL
npm run dev                         # http://localhost:3000
```

### Environment variables

| Variable | Used by | Default / example |
|---|---|---|
| `DATABASE_URL` | Next.js, `reembed_reference_cases.py` | `postgresql://postgres:<password>@localhost:5432/claimguard_demo` |
| `EMBEDDING_SERVICE_URL` | Next.js | `http://127.0.0.1:8001` |
| `SCREENING_TOP_K` | Next.js | `5` (1–40) |
| `EMBEDDING_PORT`, `EMBEDDING_HOST` | embedding service | `8001`, `127.0.0.1` |
| `EMBEDDING_HF_MODEL`, `EMBEDDING_MODEL_NAME`, `EMBEDDING_MODEL_VERSION` | embedding service, scripts | all-MiniLM-L6-v2, `normalized-v1` |
| `CLAIMGUARD_ADMIN_EMAIL` | `reembed_reference_cases.py` | first active admin |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` | database tests | libpq standard |
| `API_BASE_URL` / `BASE_URL` | API tests / screenshot script | `http://127.0.0.1:3000` |

Secrets belong only in `backend/.env.local` (git-ignored). Never commit credentials.

## Demo accounts

All accounts are synthetic. Every seeded user's password is `<ROLE>!Test2026`.

| Role | Email | Password | Lands on |
|---|---|---|---|
| Policyholder | `holder.ananya@example.com` | `POLICYHOLDER!Test2026` | `/my-claims` |
| Policyholder | `holder.kavitha@example.com` | `POLICYHOLDER!Test2026` | `/my-claims` (claim waiting for information) |
| Claims adjuster | `adjuster.arjun@claimguard.internal` | `CLAIMS_ADJUSTER!Test2026` | `/` dashboard, `/adjuster/queue` |
| Admin | `admin.priya@claimguard.internal` | `ADMIN!Test2026` | `/` dashboard, `/admin` |

`admin.deepa@claimguard.internal` is deactivated and cannot sign in.

**Viva walk-through:**
1. As Ananya, submit a claim that paraphrases a pattern (e.g. a garage billing parts that were never broken).
2. As Arjun, open it from the queue: *Matches found*, **HIGH**, *Human review required*. Approve is refused by the database.
3. Request information. As Ananya, answer it. As Arjun, approve.
4. Open **Similarity search** and click **Use an example**.

## Screenshots

Captured headlessly with [`scripts/screenshots.mjs`](scripts/screenshots.mjs) (Playwright, 1440×900) on synthetic data.

| | |
|---|---|
| **Sign in**<br>![Sign in](docs/screenshots/01-login.png) | **Policyholder: my claims**<br>![My claims](docs/screenshots/02-policyholder-my-claims.png) |
| **Policyholder: submit a claim**<br>![Submit claim](docs/screenshots/03-policyholder-submit-claim.png) | **Policyholder: claim timeline**<br>![Claim timeline](docs/screenshots/04-policyholder-claim-timeline.png) |
| **Notifications**<br>![Notifications](docs/screenshots/05-policyholder-notifications.png) | **Staff dashboard**<br>![Dashboard](docs/screenshots/06-adjuster-dashboard.png) |
| **Review queue with full-text search**<br>![Queue](docs/screenshots/07-adjuster-queue-search.png) | **Claim review: ranked similar fraud cases**<br>![Evidence](docs/screenshots/08-adjuster-claim-evidence.png) |
| **Claim waiting for the policyholder**<br>![Awaiting info](docs/screenshots/09-adjuster-claim-awaiting-info.png) | **Similarity search**<br>![Similarity search](docs/screenshots/10-similarity-search.png) |
| **Admin reports (views)**<br>![Reports](docs/screenshots/11-admin-reports.png) | **Reference fraud cases**<br>![Reference cases](docs/screenshots/12-admin-reference-cases.png) |
| **Audit log**<br>![Audit log](docs/screenshots/13-admin-audit-log.png) | **Policies**<br>![Policies](docs/screenshots/14-admin-policies.png) |
| **Users and sessions**<br>![Users](docs/screenshots/15-admin-users.png) | |

## Testing

| Suite | Result (observed) |
|---|---|
| Database tests: [`database/tests/claimguard_tests_v4.py`](database/tests/claimguard_tests_v4.py), schema v4 + migrations 001–004 on PostgreSQL 16 | **153 / 153 passed** |
| API tests: [`backend/tests/api.test.mjs`](backend/tests/api.test.mjs), 4 demo roles against the running app | **23 / 23 passed** |
| Semantic sanity check (AC-15): HIGH flag on 16 synthetic sentences | precision 1.00, recall 0.75 (thresholds tuned on the same sample) |
| `npm run typecheck`, `npm run build` | pass |

Details, the test-to-requirement mapping, how to run each suite and the bugs the tests found:
[`docs/TESTING.md`](docs/TESTING.md). Raw output: [`docs/test_results.txt`](docs/test_results.txt).

## Team and individual contributions

Based on the git history of this repository.

| Member | Contributions |
|---|---|
| **Hrushikesh Karnam** (PES1UG24CS668) | SRS v2.0 and system architecture document; ER model and relational schema v4 (`claimguard_schema_v4.sql`: tables, constraints, triggers, views, HNSW index); synthetic seed data; the initial SQL query collection and execution evidence; the database test suite (`claimguard_tests_v4.py`); the initial Next.js dashboard and API; repository structure and setup documentation |
| **Nishant Hegde** (PES1UG24CS681) | Authentication and database sessions (migration 001); migrations 002–004 and the procedures `sp_screen_claim`, `sp_decide_claim`, `sp_revise_reference_case`; the embedding service, reference-case seed and vector screening; claim submission, review, information-response, notification and admin workflows; reference-case management; the reset script, query fixes (recursive CTE, Section H), test extensions, API tests, diagrams v6 and this documentation |

## Known limitations

- **Synthetic data only.** The 18 fraud patterns and all claims are invented. The risk thresholds were
  calibrated on 16 sentences, so the precision/recall figures are a sanity check, not real accuracy.
- **Similarity is lexical-semantic, not causal.** A genuine claim in the same domain can score MEDIUM
  (one ordinary rear-end collision scored 0.57). Adjusters must read the evidence.
- **Screening runs during the submit request.** There is no background worker or automatic retry;
  stale PENDING claims are listed (`v_stale_pending_screening`) and re-screened manually.
- **Rule definitions can still be edited.** A risk rule that existing assessments reference cannot be
  renamed or deleted (FK), but its JSON `definition` can be changed; publish a new version instead.
- **Audit gaps.** Policy issuance is audited against the holder (no policy-level target), and
  notification dismissal is recorded with the SYSTEM actor.
- **No self-service registration** or password reset; accounts come from the seed or an admin.
- **The API test suite** needs a freshly built database each run.

## Conclusion and future enhancements

ClaimGuard shows that one PostgreSQL database can be both the integrity layer and the semantic search
layer of a workflow application. The claim lifecycle, approval rules and audit trail are enforced by
constraints, triggers and transactional procedures. pgvector adds meaning-based retrieval inside the
same transactions, with real foreign keys from matches to the evidence they cite.

Future work:
- Evaluate on a larger, independent labelled set before trusting any threshold.
- Add a background worker with bounded retries for PENDING and FAILED screenings.
- Make published risk-rule definitions immutable, and add a policy-level audit target.
- Embed information responses and re-screen on request (with the SRS change approved first).
- Add self-registration, password reset and per-adjuster assignment.
- Add browser end-to-end tests and performance measurements on a larger dataset.
