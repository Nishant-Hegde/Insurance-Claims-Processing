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

## Database Setup

The exact setup commands depend on the checked-in SQL and the local
PostgreSQL/pgvector installation. Before running the database scripts:

1.  Install a compatible PostgreSQL 16 environment.
2.  Install/enable a compatible pgvector extension.
3.  Create a dedicated development/test database.
4.  Configure the database connection through local environment
    configuration; never commit real credentials.
5.  Apply schema/migrations in the documented order.
6.  Load synthetic seed data.
7.  Run database tests against a disposable test database.

Do not run destructive setup or test scripts against a production or
valuable shared database. Document the exact extension versions and
tested commands after they have been verified on the team machines.

## Configuration and Secrets

Use a local environment file for credentials and connection strings.
Keep it out of version control. Commit only a sanitized `.env.example`
that lists required variable names and safe placeholder values.

Never commit: - Database passwords or connection strings containing
credentials - API keys, tokens, private keys, or session secrets - Real
policyholder information, claim documents, or production records

## Testing and Verification Status

The current test runner is `claimguard_tests_v4.py`. Its Python syntax
was checked, but the test suite has **not yet been verified through a
full run against PostgreSQL + pgvector**. Therefore, this README does
not claim that all tests pass.

Before calling the project verified, run the SQL against a clean
disposable database and execute the test suite. Verify at minimum:

-   Database creation, extensions, constraints, indexes, functions,
    triggers, and views
-   Role and policy ownership enforcement
-   Claim submission and screening success/failure states
-   Similarity retrieval and model compatibility
-   Risk-rule versioning and HIGH-risk manual-review enforcement
-   Review/decision transaction integrity and audit logging
-   Information-request/response authorization and append-only response
    history
-   Notification ownership
-   Full-text search, operational/analytical queries, and
    stale-screening recovery

Record actual test totals, failures, environment versions, semantic
evaluation dataset size, and performance measurements only after running
the relevant checks. Use synthetic, labelled examples for semantic
evaluation and state the dataset's limitations.

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
