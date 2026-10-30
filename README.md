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
│   └── 001_user_session_auth.sql
├── seed/
│   ├── claimguard_seed_v1.sql
│   └── claimguard_demo_passwords_v1.sql
├── queries/
│   ├── claimguard_queries_v1.sql
│   ├── claimguard_queries_readonly_v1.sql
│   └── readonly_execution_success.log
└── tests/
    └── claimguard_tests_v4.py
```

`claimguard_queries_v1.sql` contains the complete SQL query collection. Some sections contain intentional database modifications for constraint and trigger verification.

`claimguard_queries_readonly_v1.sql` excludes the mutation-oriented sections G9–G14 and is intended for read-only query execution.

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

### Execute Read-Only SQL Queries

```powershell
cmd /d /c "docker exec -i claimguard-db psql -X -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\queries\claimguard_queries_readonly_v1.sql"
```

To save the execution output:

```powershell
cmd /d /c "docker exec -i claimguard-db psql -X -v ON_ERROR_STOP=1 -U postgres -d claimguard_demo_20261030 < database\queries\claimguard_queries_readonly_v1.sql > database\queries\readonly_execution_success.log 2>&1"
```

The complete query collection also includes intentional constraint and trigger tests. Run those sections only against a disposable database because some statements attempt database modifications.

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
-   The risk-rule version association in SQL v4 is documented as a gap
    because the intended association is not enforced by a foreign key.
-   Risk computation and result persistence should be verified for
    atomicity and version consistency.
-   High-risk review enforcement and authorization for information
    responses must be covered by database/application tests.
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

## Current Application Implementation

The `backend/` directory contains the Next.js application, dashboard, and
API Route Handlers.

Implemented dashboard endpoints:

- `GET /api/dashboard/stats` — returns dashboard counts from PostgreSQL.
- `GET /api/claims` — returns the claims list and available screening-risk
  information.

Authentication endpoints:

- `POST /api/auth/login`: checks the email and bcrypt password, then creates a database session.
- `POST /api/auth/logout`: revokes the session in the database and clears the cookie.
- `GET /api/auth/me`: returns the signed-in user and role.

The dashboard includes loading, error, retry, and empty-data states.
An empty database can therefore display zero counts and an empty claims
list; this does not mean the full claims workflow has been implemented.

### Run the Next.js application

From the repository root:

```powershell
cd backend
npm ci
```

Copy `backend/.env.example` to `backend/.env.local` and set
`DATABASE_URL` to your local database connection. Never commit this
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

The dashboard and these API endpoints are an initial application
integration, not evidence that authentication, claim submission,
fraud-screening execution, adjuster decisions, or every SRS requirement
is complete. Verify each workflow and its authorization before claiming
full application readiness.

