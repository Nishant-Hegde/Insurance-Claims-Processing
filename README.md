# ClaimGuard --- Insurance Claims Processing with Fraud-Pattern Detection

ClaimGuard is a Database Management Systems (DBMS) project that supports
the insurance-claim lifecycle and helps authorized claims adjusters
investigate potentially related fraud patterns. It combines structured
claim and policy records with semantic similarity search over confirmed
reference cases.

> **Important:** Similarity scores and risk indicators are advisory
> evidence, not proof of fraud. ClaimGuard does not make final claim
> decisions automatically. A qualified human adjuster remains
> responsible for the decision. An incomplete or failed screening must
> never be treated as a low-risk result or as grounds for automatic
> approval.

## Project Information

  ---------------------------------------------------------------------------------
  Item                                Details
  ----------------------------------- ---------------------------------------------
  Project                             ClaimGuard

  Domain                              Insurance claims processing and fraud-pattern
                                      detection

  Course context                      DBMS Level 3 Experiential Learning Project

  Requirements baseline               `CLAIMGUARD_SRS` v2.0, dated 23 October 2026

  Architecture reference              `CLAIMGUARD_ARCH` implementation baseline
                                      v1.2 (22 October 2026); confirm
                                      document/version alignment before submission

  Database baseline                   `claimguard_schema_v4.sql`

  ER and relational-schema            `ClaimGuard_ER_and_Relational_Schema_v5.md`
  documentation                       

  Database test runner                `claimguard_tests_v4.py`
  ---------------------------------------------------------------------------------

## Problem Statement

Insurance claims require consistent lifecycle tracking, accountable
review, and auditable decisions. Exact keyword matching can miss related
cases when descriptions use different wording. ClaimGuard is designed to
retrieve semantically similar confirmed reference cases and present the
evidence to an authorized adjuster.

The system is intended to improve investigation and workflow
consistency---not to independently declare a claimant or claim
fraudulent.

## Objectives

-   Maintain consistent records for users, roles, policies, claims,
    screening assessments, matches, reviews, decisions, notifications,
    and audit events.
-   Support claim submission and tracking, screening, adjuster review,
    requests for additional information, responses, and final human
    decisions.
-   Retrieve semantically similar eligible reference cases even when
    their wording differs.
-   Calculate explainable advisory risk indicators using versioned risk
    rules.
-   Require manual review for HIGH-risk claims and preserve screening
    failure states.
-   Enforce role-based access, ownership checks, database integrity, and
    auditable state transitions.
-   Demonstrate core and advanced DBMS concepts, including keys,
    constraints, joins, transactions, functions/procedures, triggers,
    views, indexes, full-text search, and vector similarity search.
-   Validate requirements with repeatable tests and synthetic data,
    reporting only results that have actually been measured.

## Technology Stack

The following reflects the project's SRS and architecture baseline. It
is not a claim that every component has already been implemented or
runtime-verified.

  -----------------------------------------------------------------------
  Layer                   Technology              Responsibility
  ----------------------- ----------------------- -----------------------
  Web UI and              Next.js, React,         Role-specific pages and
  application/API         TypeScript              server-side Route
                                                  Handlers

  Styling                 Tailwind CSS            Web interface styling

  Embedding service       Python, FastAPI,        Converts
                          Sentence Transformers   claim/reference
                          (`all-MiniLM-L6-v2`)    descriptions into
                                                  embeddings

  Database                PostgreSQL 16           Relational records,
                                                  transactions,
                                                  constraints, functions,
                                                  triggers, views, and
                                                  audit events

  Vector search           pgvector                Stores embeddings and
                                                  retrieves semantically
                                                  similar reference cases

  Application database    `node-postgres` (`pg`)  Database access from
  access                  and parameterized SQL   the Next.js application

  Schema evolution        SQL migrations          Version-controlled
                                                  database changes

  Testing                 Python database test    Validation of
                          runner plus             constraints, workflows,
                          application/database    and screening behavior
                          tests as implemented    
  -----------------------------------------------------------------------

The architecture baseline describes three local processes: the Next.js
application, the Python embedding service, and PostgreSQL with pgvector.
Docker is not part of that baseline. Do not add deployment or
infrastructure claims unless the implementation changes and the
documentation is updated.

## High-Level Architecture

1.  **Next.js application:** serves the UI and API Route Handlers,
    enforces server-side authentication/role/ownership checks, and
    coordinates claim, screening, review, administration, and reporting
    workflows.
2.  **Python embedding service:** generates text embeddings using the
    configured Sentence Transformers model. It is a helper service and
    should not access the database directly.
3.  **PostgreSQL + pgvector:** acts as the system of record for
    relational data, vector embeddings, screening outcomes, risk-rule
    versions, workflow state, and audit events.
4.  **Database-enforced invariants:** constraints, transactions,
    functions/procedures, and triggers protect critical state changes so
    they cannot be bypassed by a different application path.

### Screening and decision principles

-   Retrieve only eligible active, confirmed reference cases.
-   Record the screening attempt and its explicit outcome, including
    failure states.
-   Keep model identity and risk-rule version associated with screening
    evidence.
-   Flag HIGH-risk claims for manual review.
-   Prevent final decisions from bypassing required screening and review
    rules.
-   Treat similarity and risk as evidence for investigation, not a
    verdict.

## Repository Layout

The repository is kept intentionally small. Add further modules only
when the implementation needs them.

``` text
Insurance-Claims-Processing/
├── srs/                         # Approved SRS and revisions
├── docs/
│   ├── architecture/            # System architecture documents
│   └── diagrams/                # ER and relational-schema diagrams
├── database/
│   ├── schema/                  # Canonical schema SQL
│   ├── migrations/              # Ordered schema migrations
│   └── tests/                   # Database-specific tests
├── backend/                     # Next.js application and Python embedding service
│   └── app/                     # Application code (structure to follow implementation)
├── frontend/                    # Optional standalone frontend, only if separated from Next.js
├── tests/                       # Cross-component or end-to-end tests
├── README.md
├── .gitignore
└── .env.example
```

**File placement note:** Next.js normally contains both its UI and Route
Handlers in the same application. The separate `frontend/` folder is
optional; do not duplicate the Next.js UI there if it remains part of
the same app. The Python embedding service can be placed in a clearly
named subdirectory under `backend/` when implementation begins. The
exact layout should be finalized to match the actual code, not empty
folders alone.

## Core Data Model

The ER diagram describes conceptual entities and relationships. The
relational schema defines columns, keys, constraints, and indexes. The
SQL file is the implementation reference; if a diagram and SQL differ,
record and resolve the discrepancy rather than assuming the diagram is
implemented.

The current SQL v4 design contains these principal relations:

-   `app_role`, `app_user`
-   `policy`, `claim`
-   `embedding_model`, `reference_fraud_case`
-   `screening_assessment`, `screening_match`
-   `review`, `claim_decision`
-   `audit_log`
-   `risk_rule`
-   `information_response`, `notification`

The SQL baseline contains 14 tables. The ER/schema documentation also
identifies a risk-rule version association that is not yet enforced as a
foreign key in the current SQL; this is a known implementation gap to
resolve or explicitly accept and document.

## Main Workflows

### 1. Claim submission and screening

1.  An authenticated policyholder submits a claim against an eligible
    policy they own.
2.  The claim and its workflow state are persisted.
3.  The embedding service generates a description embedding.
4.  PostgreSQL/pgvector retrieves eligible semantically similar
    reference cases.
5.  The screening result, matched evidence, and applicable risk-rule
    version are recorded.
6.  A HIGH-risk result requires manual review. A failed or incomplete
    screening remains explicitly failed/pending and is not considered
    low risk.

### 2. Adjuster review and decision

1.  An authorized adjuster views the review queue and claim evidence.
2.  The adjuster reviews the claim, screening evidence, and related
    reference cases.
3.  The adjuster may approve, reject, or request additional information,
    subject to the defined workflow rules.
4.  Information responses and decisions are recorded with appropriate
    authorization and audit history.
5.  The final claim decision is made by a human adjuster, not
    automatically by similarity scoring.

### 3. Administration and audit

Authorized administrators manage users/roles, policies, confirmed
reference cases, and versioned risk rules according to the requirements.
Important changes and workflow actions should be auditable.

## Database Setup and Execution

### Verified Database Environment

The database schema and synthetic seed data were successfully executed against a disposable PostgreSQL database using Docker.

| Component | Verified configuration |
|---|---|
| Database | PostgreSQL |
| Docker image | `pgvector/pgvector:pg17` |
| Container | `claimguard-db` |
| Database user | `postgres` |
| Database used for validation | `claimguard_demo_20261030` |
| Vector extension | pgvector |

The current runtime validation used PostgreSQL 17 through the pgvector Docker image. This is distinct from the PostgreSQL 16 baseline described in the original architecture documentation.

### Database Files

```text
database/
├── schema/
│   └── claimguard_schema_v4.sql
├── migrations/
│   ├── 001_user_session_auth.sql
│   ├── 002_risk_rule_fk_and_procedure.sql
│   ├── 003_reference_case_versioning.sql
│   └── 004_workflow_guards.sql
├── seed/
│   ├── claimguard_seed_v1.sql
│   ├── claimguard_demo_passwords_v1.sql
│   └── claimguard_reference_cases_v2.sql   # GENERATED: 18 cases with real embeddings
├── scripts/
│   └── reset_db.sql              # DESTRUCTIVE: disposable dev databases only
├── queries/
│   ├── claimguard_queries_v1.sql
│   ├── claimguard_queries_readonly_v1.sql
│   └── execution_log.txt         # psql output of the full collection
└── tests/
    └── claimguard_tests_v4.py
```

`claimguard_queries_v1.sql` contains the complete SQL query collection. Some sections contain intentional database modifications for constraint and trigger verification (G9–G14) and procedure demos that commit (H4–H7).

`claimguard_queries_readonly_v1.sql` excludes those sections. Its section H only runs demos that are rolled back, so it leaves the database unchanged.

**Apply order (fresh database):**

1. `schema/claimguard_schema_v4.sql`
2. `seed/claimguard_seed_v1.sql`
3. `migrations/001_user_session_auth.sql`
4. `seed/claimguard_demo_passwords_v1.sql`
5. `migrations/002_risk_rule_fk_and_procedure.sql`
6. `migrations/003_reference_case_versioning.sql`
7. `migrations/004_workflow_guards.sql` (information-response rules, HIGH-risk approval rule, user status audit)
8. `seed/claimguard_reference_cases_v2.sql` (real-model reference cases + calibrated risk rule `v2.0-minilm`)
9. Optional: `embedding-service/scripts/reembed_reference_cases.py`, which moves the 6 active v1 cases onto the real model as new versions
10. `queries/claimguard_queries_v1.sql` (or the read-only subset). It runs at any point after step 5; `execution_log.txt` records a run after step 8.

To start over, run `scripts/reset_db.sql` and repeat from step 1.

### Prerequisites

- Docker Desktop installed and running.
- A PostgreSQL-compatible pgvector Docker image.
- PowerShell on Windows.

### Start the Database Container

If the container has already been created, start it:

```powershell
docker start claimguard-db
```

For a new environment, create a container using the `pgvector/pgvector:pg17` image and a persistent Docker volume. Configure a local PostgreSQL password; do not commit credentials.

### Create a Disposable Database

The following commands use the validation database name. Choose a different name when reproducing the setup to avoid overwriting an existing database.

```powershell
docker exec claimguard-db psql -U postgres -d postgres -c "CREATE DATABASE claimguard_demo_20261030;"
```

### Apply the Database Schema

From the repository root:

```powershell
cmd /d /c "docker exec -i claimguard-db psql -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\schema\claimguard_schema_v4.sql"
```

The schema creates 14 relational tables along with database constraints, indexes, functions, triggers, and views.

### Load Synthetic Seed Data

```powershell
cmd /d /c "docker exec -i claimguard-db psql -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\seed\claimguard_seed_v1.sql"
```

The seed file inserts synthetic records across the database tables. Its 384-dimensional vectors are deterministic test vectors, not embeddings generated by the production Sentence Transformers model.

### Apply the Login Migration and Demo Passwords

```powershell
cmd /d /c "docker exec -i claimguard-db psql -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\migrations\001_user_session_auth.sql"
cmd /d /c "docker exec -i claimguard-db psql -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\seed\claimguard_demo_passwords_v1.sql"
```

The migration adds the `user_session` table and the database-side role checks. The second file gives the synthetic seed users real bcrypt password hashes. See [Authentication and Roles](#authentication-and-roles).

### Apply Migration 002 (risk-rule FK and procedures)

Apply after migration 001 and the demo passwords:

```powershell
cmd /d /c "docker exec -i claimguard-db psql -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\migrations\002_risk_rule_fk_and_procedure.sql"
```

Migration 002 adds:

- **FK `screening_assessment.risk_rule_version → risk_rule.rule_version`** (`ON UPDATE/DELETE RESTRICT`). If the database already has it (schema v4.1 declares it), the migration leaves it unchanged. If an existing assessment names an unknown rule version, the migration stops and lists it.
- **`sp_screen_claim(claim, model, embedding, top_k, failure_reason)`** records one screening attempt atomically. It assigns the next `attempt_no`, finds the top-k nearest active, confirmed reference cases with `<=>`, stores matches with similarity `1 − cosine distance`, and stores the risk under the locked active rule, cross-checked with `fn_compute_claim_risk`. Any error is stored as a `FAILED` attempt with a reason, never as `LOW`.
- **`sp_decide_claim(claim, reviewer, action, notes)`** records the review, plus the `claim_decision` for `APPROVED`/`REJECTED`, plus a notification to the policyholder. It runs all-or-nothing and respects `fn_assert_approvable`.

Both procedures run inside the caller's transaction (`BEGIN; CALL …; COMMIT;` or `ROLLBACK;`). Section H of the query file demonstrates both.

### Reset a Disposable Database

```powershell
cmd /d /c "docker exec -i claimguard-db psql -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\scripts\reset_db.sql"
```

> **Warning:** `reset_db.sql` drops every ClaimGuard view, procedure, table and function, along with all their data. It refuses to run unless the database name contains `demo`, `dev`, `test` or `scratch`, and it runs in one transaction. After a reset, apply the files again in the order above.

### Execute Read-Only SQL Queries

```powershell
cmd /d /c "docker exec -i claimguard-db psql -X -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\queries\claimguard_queries_readonly_v1.sql"
```

To save the execution output:

```powershell
cmd /d /c "docker exec -i claimguard-db psql -X -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\queries\claimguard_queries_readonly_v1.sql > database\queries\readonly_execution_success.log 2>&1"
```

The complete query collection also includes intentional constraint and trigger tests. Run those sections only against a disposable database because some statements attempt database modifications.

To run the complete collection (including the migration 002 procedure demos) on a freshly built disposable database:

```powershell
cmd /d /c "docker exec -i claimguard-db psql -X -e -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\queries\claimguard_queries_v1.sql > database\queries\execution_log.txt 2>&1"
```

`database/queries/execution_log.txt` holds a verified run: reset → schema v4 → seed → migration 001 → demo passwords → migrations 002, 003, 004 → reference cases v2 → read-only queries → full query collection, on PostgreSQL 17.11 with pgvector 0.8.7, with every step exiting `0`. The full collection runs once per fresh database: a second run stops at H5 because claim 4 is then already decided.

### Verified Seed Data

The synthetic seed data was successfully loaded and verified.

| Table | Verified rows |
|---|---:|
| app_role | 3 |
| app_user | 12 |
| audit_log | 26 |
| claim | 6 |
| claim_decision | 3 |
| embedding_model | 1 |
| information_response | 1 |
| notification | 5 |
| policy | 6 |
| reference_fraud_case | 7 |
| review | 5 |
| risk_rule | 2 |
| screening_assessment | 5 |
| screening_match | 9 |
| **Total** | **86** |

### Database Safety

- Use disposable databases for schema installation, seed loading, and database tests.
- Do not execute mutation-oriented demonstration queries against valuable or shared databases.
- Preserve existing database volumes and development data.
- Never commit local database passwords, connection strings, or credentials.

## Configuration and Secrets

Use a local environment file for credentials and connection strings.
Keep it out of version control. Commit only a sanitized `.env.example`
that lists required variable names and safe placeholder values.

Never commit: - Database passwords or connection strings containing
credentials - API keys, tokens, private keys, or session secrets - Real
policyholder information, claim documents, or production records

The database schema and synthetic seed data have been successfully executed against the disposable PostgreSQL database `claimguard_demo_20261030`.

Verification confirmed:

- Successful creation of all 14 database tables.
- Successful loading of synthetic seed data.
- 86 seeded rows across the 14 tables.
- Successful execution of the read-only SQL query collection.
- Successful completion of the final table-count query.
- PostgreSQL execution exit code: `0`.

The read-only SQL execution output is preserved in `database/queries/readonly_execution_success.log`.

The Python database test runner has not yet been verified through a complete test-suite execution. Application-level workflow and semantic-model evaluation must also be assessed separately.

## Authentication and Roles

Users sign in at `/login`. Each role sees a different part of the app:

| Role | After sign-in | Can access |
|---|---|---|
| Policyholder | `/my-claims` | Only their own claims (`/api/claims` is filtered to their user ID) |
| Claims adjuster | `/` dashboard | All claims and dashboard statistics |
| Admin | `/` dashboard | Everything adjusters see, plus `/admin/users` (users, roles, live sessions) |

Requests outside a user's role get `403` from the API, or a redirect to that user's own home page.

**How it works**

- **Passwords:** stored only as bcrypt hashes in `app_user.password_hash` and checked with `bcryptjs`. A wrong email and a wrong password return the same message.
- **Sessions:** login creates a row in `user_session`. The browser gets a random token in an `httpOnly` cookie. The database stores only the token's SHA-256 hash, so a database dump can't be used to log in.
- **Every request is checked in the database:** `fn_session_principal(token_hash)` returns the user and role only if the session isn't expired or revoked and the user is still active.
- **Database-side rules (migration 001):**
  - `trg_session_insert_guard`: inactive users can't get a session.
  - `trg_session_update_guard`: a session can only be revoked, never edited or un-revoked.
  - `trg_user_deactivate_revoke_sessions`: deactivating a user signs them out everywhere.
  - `fn_user_has_role(user, VARIADIC roles)`: role check that can be called from SQL.
  - `v_active_session`: view of current live sessions.
  - CHECK constraints on the token hash format and a 7-day maximum session length.
- **`proxy.ts`:** sends visitors without a session cookie to `/login`. This is only a first-pass check; the database check above is the one that decides access.

**Demo accounts** (synthetic seed data only): every seeded user's password is `<ROLE>!Test2026`, for example:

| Email | Password |
|---|---|
| `admin.priya@claimguard.internal` | `ADMIN!Test2026` |
| `adjuster.arjun@claimguard.internal` | `CLAIMS_ADJUSTER!Test2026` |
| `holder.ananya@example.com` | `POLICYHOLDER!Test2026` |

`admin.deepa@claimguard.internal` is deactivated and can't sign in.

## Known Gaps and Documentation Alignment

-   The SQL, ER diagram, relational schema, architecture, and tests must
    be checked against one another before submission.
-   Similarity thresholds (`v2.0-minilm`) are calibrated on a small
    synthetic sample only; measure them on representative data before
    relying on them.
-   The risk-rule version association is enforced by a foreign key
    (migration 002). Risk computation and persistence are atomic in
    `sp_screen_claim`. Editing the definition of a rule already used by a
    screening is not yet blocked.
-   HIGH-risk approval and information-response authorization are
    enforced in the database (migration 004) and covered by the
    end-to-end API test, but not yet by `claimguard_tests_v4.py`.
-   The schema's `NOTIFICATION_DISMISSED` audit trigger always records
    the SYSTEM actor, even though the user is known.
-   The architecture reference in the SRS and the available architecture
    file have different version labels. Confirm the approved
    architecture version and update cross-references consistently.
-   Do not claim full requirement coverage until each applicable
    requirement is mapped to implementation and test evidence.

## Team

  -----------------------------------------------------------------------
  Member                              Primary responsibilities in the SRS
                                      baseline
  ----------------------------------- -----------------------------------
  Hrushikesh Karnam                   Database/schema and integrity
                                      review; claim workflow and
                                      screening integration; tests and
                                      documentation coordination

  Nishant Hegde                       Architecture and API/service
                                      implementation; database
                                      procedure/trigger integration;
                                      review workflow and test
                                      coordination
  -----------------------------------------------------------------------

Adjust this table to reflect actual contribution history before final
submission.

## Development Principles

-   Keep the SRS as the requirements baseline.
-   Keep the ER diagram, relational schema, SQL implementation,
    architecture, and tests consistent.
-   Use SQL migrations as the controlled path for database changes.
-   Use synthetic data for development and testing.
-   Enforce authorization server-side and critical invariants in the
    database.
-   Treat similarity/risk as advisory evidence and preserve human
    decision authority.
-   Document known limitations and report only verified implementation
    and test results.

## Project Status

The requirements and architecture documents, ER/schema artifacts, SQL
schema, and Python test runner have been prepared. Database runtime
validation and full test execution remain pending. Update this section
when those checks have actually been completed.

<!-- CURRENT IMPLEMENTATION STATUS -->

## Embedding Service and Vector Screening

`embedding-service/` is a small Python FastAPI service. It loads
`sentence-transformers/all-MiniLM-L6-v2` once at startup and returns
L2-normalised 384-dimension vectors. It never touches the database: the
Next.js backend calls it and passes the vector to PostgreSQL.

| Endpoint | Purpose |
|---|---|
| `POST /embed` `{ "text": "..." }` | `{ model_name, model_version, dimension, embedding: float[384] }` |
| `GET /health` | Whether the model is loaded |

**Install and run** (Python 3.13, Windows, CPU only, no Docker):

```powershell
cd embedding-service
py -3.13 -m venv .venv
.venv\Scripts\python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0
.venv\Scripts\python -m pip install -r requirements.txt
$env:EMBEDDING_PORT = "8001"      # optional, 8001 is the default
.venv\Scripts\python app.py
```

The first start downloads the model (about 90 MB), and loading takes about 15 s. Then set
`EMBEDDING_SERVICE_URL=http://127.0.0.1:8001` in `backend/.env.local`.

**Scripts** (run from `embedding-service/`):

| Script | What it does |
|---|---|
| `scripts/generate_reference_seed.py` | Embeds `data/reference_cases.json` (18 synthetic fraud patterns) and writes `database/seed/claimguard_reference_cases_v2.sql`. That file registers the model, the cases and the calibrated risk rule. |
| `scripts/reembed_reference_cases.py [--dry-run]` | Reads `DATABASE_URL` from the environment and re-embeds every active case that is still on another model, in one transaction. |
| `scripts/calibrate_thresholds.py` | Prints the top similarities of fraud-like and ordinary sample claims, used to choose the risk-rule thresholds. |

**Why "re-embed" and "edit" create new rows.** `fn_ref_case_immutable`
forbids updating a reference case's text or vector, because past
`screening_match` rows must keep pointing at the exact evidence an
adjuster saw. Migration 003 therefore adds `supersedes_case_id` and
`sp_revise_reference_case`, which deactivates the old row and inserts the
new version in one transaction. Both steps are audited
(`REFERENCE_CASE_ADDED` / `REFERENCE_CASE_DEACTIVATED`). Migration 003 also
fixes the identity sequences that the v1 seed left behind, adds a
full-text index on cases, and is required by the scripts and the admin pages.

**Risk thresholds.** Rule v1.1 (HIGH ≥ 0.80) was tuned for the placeholder
vectors. On the real model, `calibrate_thresholds.py` gave these top similarities:

- fraud-like paraphrases: 0.57–0.81 (mean 0.69)
- ordinary claims: 0.37–0.57 (mean 0.43)

The seed therefore adds and activates `v2.0-minilm` with HIGH ≥ 0.65 and MEDIUM ≥ 0.55. This is a
sanity check on 16 synthetic sentences, not a validated evaluation.
Assessments scored earlier keep their own rule version.

### Vector API (Next.js)

All database access is server-side through the shared pool with
parameterised SQL. Every route checks the session and role in the
database: no session returns 401, the wrong role returns 403.

| Route | Roles | Behaviour |
|---|---|---|
| `POST /api/claims` | Policyholder | Validates input and checks the policy is the caller's own active policy. Inserts and commits the claim, embeds the description, then runs `BEGIN; CALL sp_screen_claim(...); COMMIT`. If the embedding service is down, the claim is still accepted and the attempt is stored as **FAILED** (never LOW). The response does not include the risk result. |
| `GET /api/claims/[id]` | All | Policyholders see only their own claim (others return 404), with no fraud evidence. Staff also see every screening attempt with ranked matches, similarity scores and reference-case titles. |
| `POST /api/claims/[id]/rescreen` | Adjuster, Admin | Starts a new attempt for a FAILED or PENDING screening. The staff member is the audit actor. |
| `GET /api/similar?text=…&k=5` | Adjuster, Admin | Ad-hoc semantic search: top-k active cases by cosine similarity (HNSW index). |
| `GET /api/reference-cases?status=&q=` | Admin | List with an active/inactive/all filter and full-text search. |
| `GET /api/reference-cases/[id]` | Admin | Details plus the version chain (`WITH RECURSIVE`). |
| `POST /api/reference-cases` | Admin | Embeds the description, then inserts it. Returns 503 if the service is down, so no unsearchable case is stored. |
| `PATCH /api/reference-cases/[id]` | Admin | Saves a new re-embedded version via `sp_revise_reference_case`. |
| `POST /api/reference-cases/[id]/deactivate` | Admin | One-way deactivation. |

Pages: `/my-claims/new` (claim form), `/adjuster/claims/[id]` (evidence and
re-screen button), `/similar` (staff search), and `/admin/reference-cases`
(list, search, filter, create, edit as a new version, deactivate). The full
page list is under [Current Application Implementation](#current-application-implementation).

### Demo (viva)

1. Start PostgreSQL. Apply the files in the apply order above, including steps 6–8.
2. Start the embedding service, then `cd backend` and `npm run dev`.
3. Sign in as `adjuster.arjun@claimguard.internal`, open **Similarity search**,
   and click **Use an example**. The staged-collision patterns rank first,
   although the text shares few words with them.
4. Sign in as `holder.ananya@example.com`. On **My claims**, submit a claim
   (policy POL-2026-0001, a date in 2026 not after today) that paraphrases a
   pattern, e.g. *"Minor collision damaged my front bumper and one headlight.
   The insurer approved that estimate, but the garage (my wife's brother runs
   it) later billed a new radiator, both airbags and an engine mount as well."*
   The policyholder sees only "received and checked".
5. As the adjuster, open the new claim from the dashboard. It shows
   *Matches found*, top match 0.722 *Repair invoice inflated by the workshop*,
   **HIGH risk · rule v2.0-minilm** and **Human review required**.
   Submit an unrelated claim (a cracked laptop screen): its top match is about
   0.37, so LOW.
6. Stop the embedding service and submit another claim. It is accepted and
   the adjuster sees *Screening failed, not "low risk"*. Restart the service
   and click **Re-run screening**: attempt 2 completes.
7. As `admin.priya@claimguard.internal`, open **Reference cases**. Create a case,
   edit it (a new version appears in the version history and the old one
   becomes inactive), and deactivate it.

## Current Application Implementation

The `backend/` directory holds the Next.js application. Every page and API
route checks the session and role in the database (`fn_session_principal`),
uses parameterised SQL through the shared pool, and validates input on the
server. Errors raised by database constraints and triggers are reworded into
plain messages (`app/lib/http.ts`): a broken rule returns 422, a conflicting
state (such as "already decided") returns 409, a missing record returns 404,
and a wrong role returns 403. The navigation changes per role.

### Workflow rules added by migration 004

| Rule | Where it is enforced |
|---|---|
| Only the claim's own policyholder may answer, and only the latest unanswered `INFO_REQUESTED` review of a claim that is `AWAITING_INFO` | `trg_information_response_guard` (BEFORE INSERT) |
| Answering moves the claim back to `UNDER_REVIEW` and notifies the requesting adjuster | `trg_information_response_followup` (AFTER INSERT) |
| A HIGH-risk claim (`review_required`) can be approved only after an information request was made and every request has been answered | `fn_assert_approvable`, which `trg_review_guard` and `trg_claim_decision_guard` both call |
| The last active admin cannot be deactivated; every activation change is audited | `trg_user_status_guard`, `trg_user_status_audit` |

### Pages and routes, and the SQL feature each one demonstrates

| Role | Page / route | What it does | SQL feature for the viva |
|---|---|---|---|
| Policyholder | `/my-claims/new` → `POST /api/claims` | Submit a claim on an owned active policy. Shows the screening status only. | Ownership check plus INSERT in a transaction. `trg_claim_insert_guard` checks the date range. `CALL sp_screen_claim` runs a pgvector top-k search. |
| Policyholder | `/my-claims`, `/my-claims/[id]` | Own claims, status timeline, answer form | Timeline is one `UNION ALL` over 5 tables. `JOIN LATERAL … LIMIT 1` finds the latest review. Ownership is filtered in SQL, so someone else's claim returns 404. |
| Policyholder | `POST /api/claims/[id]/responses` | Answer an information request | BEFORE/AFTER triggers (migration 004). The claim row is locked with `SELECT … FOR UPDATE`, and the audit row is written by a trigger. |
| All | `/notifications`, `PATCH /api/notifications/[id]`, `POST /api/notifications/read-all` | Mark read, dismiss | UPDATE limited to `read_at`/`dismissed_at` by `trg_notification_update_guard` and the `CHECK` read-before-dismiss rule. Uses the partial index `ix_notification_inbox`. Dismissal is audited. |
| Adjuster | `/adjuster/queue` | Filter by status, risk and date range; sort; keyword search | Reads the views `v_review_queue` and `v_high_risk_aged_queue`. Full-text search with `websearch_to_tsquery`, ordered by `ts_rank` and highlighted with `ts_headline`, using the GIN index `ix_claim_description_fts`. ORDER BY comes from a whitelist. |
| Adjuster | `/adjuster/claims/[id]` | Claim, policy, screening attempts, ranked matches, review history, answers | `json_agg(… ORDER BY rank)` for matches. A correlated subquery counts other claims on the policy. `LEFT JOIN information_response`. |
| Adjuster | `POST /api/claims/[id]/review` | Approve, reject or request information | `BEGIN; CALL sp_decide_claim(…); COMMIT`, with ROLLBACK on error. The HIGH-risk guard error is shown as a readable message. |
| Adjuster/Admin | `POST /api/claims/[id]/rescreen`, `/similar` | Re-run a failed screening; ad-hoc semantic search | Next `attempt_no`; cosine `<=>` search with the HNSW index |
| Admin | `/admin` | Reports | The five reporting views: `v_claim_status_summary`, `v_risk_distribution_over_time`, `v_reference_match_frequency`, `v_adjuster_workload`, `v_stale_pending_screening` |
| Admin | `/admin/audit` | Audit viewer with action, actor and claim filters, and pagination | `count(*) OVER ()` gives the total and the page in one query; `LIMIT/OFFSET`. The audit table is append-only (`trg_audit_log_append_only`). |
| Admin | `/admin/policies` → `POST /api/admin/policies` | Issue and list policies | INSERT checked by `UNIQUE`, `CHECK (expiry > effective)` and the holder-role trigger, with the `POLICY_ISSUED` audit row. The list is a `GROUP BY` with `sum`/`count`. |
| Admin | `/admin/users` → `PATCH /api/admin/users/[id]` | Activate or deactivate users | UPDATE fires `trg_user_deactivate_revoke_sessions`, which signs the user out everywhere, plus the last-admin guard and the audit row |
| Admin | `/admin/reference-cases` | Fraud-pattern library | Versioning through `sp_revise_reference_case`; version chain via `WITH RECURSIVE` |

### Verified

- `npm run typecheck` and `npm run build` pass.
- An end-to-end API test signed in as all four demo roles against a fresh
  database. Each check below passed:
  - submit, then approval blocked by the HIGH-risk guard
  - request information, then approval still blocked
  - another policyholder cannot answer; a second answer is refused
  - the answer is accepted, the claim returns to UNDER_REVIEW, and the adjuster is notified
  - approve, then any further action returns 409
  - notifications: read, dismiss, and another user's notification returns 404
  - policies: issue, duplicate number, non-policyholder holder, bad dates
  - deactivating a user revokes their live session, then reactivate
  - page access and redirects for every role
- `EXPLAIN` confirms the queue search uses `ix_claim_description_fts`.

### Run the Next.js application

From the repository root:

```powershell
cd backend
npm ci
```

Copy `backend/.env.example` to `backend/.env.local` and set
`DATABASE_URL` to your local database connection and
`EMBEDDING_SERVICE_URL` to the embedding service. Never commit this
file or share its credentials.

Start the development server:

```powershell
npm run dev
```

Open `http://localhost:3000`.

Run the available application checks:

```powershell
npm run typecheck
npm run build
```

Similarity scores, risk thresholds and the HIGH-risk rule are advisory
controls on synthetic data. A human adjuster always makes the decision.

