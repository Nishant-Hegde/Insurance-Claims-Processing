# ClaimGuard — rubric mapping (DBMS Level 3, 50 marks)

Each rubric item, the files, pages and queries that satisfy it, and a demo that fits in under a minute.
The **Self-assessment** column is our honest reading of the evidence, not a grade. The item marked ⚠
is at risk and is explained in [Weak or missing](#weak-or-missing), together with the two gaps already fixed.

Demo setup: a database built with the apply order in the README (we use `claimguard_demo`), the
embedding service on port 8001, and `npm run dev` in `backend/`. "psql" below means
`psql -d claimguard_demo`. Demo accounts are in the README.

## Summary

| # | Item | Marks | Self-assessment |
|---|---|---|---|
| 1 | ER diagram | 2 | Correct |
| 2 | Relational schema with keys, relationships, constraints | 3 | Correct |
| 3 | SQL database implementation – DDL with constraints | 4 | Correct |
| 4 | NoSQL/Vector database creation | 4 | Correct |
| 5 | Technology justification | 1 | Correct |
| 6 | DML operations | 4 | Correct (INSERT, UPDATE and a real DELETE in §G14b; business tables refuse DELETE by design) |
| 7 | Nested/correlated/recursive queries, JOIN queries | 4 | Correct |
| 8 | Advanced SQL – procedure/function, trigger, CTE | 6 | Correct |
| 9 | NoSQL/Vector feature, RUD (Read, Update, Delete) | 7 | ⚠ Read correct; Update and Delete are versioned / soft by design and must be explained |
| 10 | Next.js interface | 3 | Correct |
| 11 | Backend/API and database integration | 2 | Correct |
| 12 | Authentication – front end, ≥ 2 roles, RBAC in the database | 4 | Correct (application roles enforced by triggers + PostgreSQL roles and GRANTs, migration 005) |
| 13 | Documentation, Git/GitHub | 2 | Correct |
| 14 | Originality, individual contribution, modification/viva | 4 | Correct if the modification goes smoothly; see the practice list |

## 1. ER diagram (2 marks)

- **Evidence:** [`docs/ClaimGuard_ER_Diagram_Chen.png`](ClaimGuard_ER_Diagram_Chen.png) (source [`.svg`](ClaimGuard_ER_Diagram_Chen.svg), [`.pdf`](ClaimGuard_ER_Diagram_Chen.pdf)), embedded in the README §ER diagram. Notation and cardinalities are explained in [`ClaimGuard_ER_and_Relational_Schema_v6.md`](ClaimGuard_ER_and_Relational_Schema_v6.md) §1 and §3.
- **What it shows:**
  - 15 entities in Chen notation, with attributes, keys and cardinalities
  - total and partial participation
  - a weak entity (`SCREENING_ASSESSMENT`, partial key `attempt_no`)
  - an M:N relationship with attributes (`MATCHES`: `similarity_score`, `match_rank`)
  - a recursive 1:1 relationship (`REVISES`)
- **Demo (< 1 min):** open the PNG. Point out CLAIM → SCREENED_BY (weak entity, double lines), MATCHES (M:N with attributes) and REVISES (recursive).

## 2. Relational schema with keys, relationships, and constraints (3 marks)

- **Evidence:**
  - [`docs/ClaimGuard_Relational_Schema_v6.png`](ClaimGuard_Relational_Schema_v6.png) shows every relation with its underlined primary key and an arrow from each foreign key to the key it references.
  - [`ClaimGuard_ER_and_Relational_Schema_v6.md`](ClaimGuard_ER_and_Relational_Schema_v6.md) §2.1 lists the integrity mechanisms per table, §3 the cardinality and enforcing constraint, §5 normalization.
  - [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md) lists every constraint as defined in the catalog.
- **Demo:**
  - Show the v6 PNG, then the composite FK `claim(policy_id, claimant_id) → policy(policy_id, holder_id)` in DATA_DICTIONARY §claim.
  - Explain that it forces the claimant to be the policy holder.
  - Then show `supersedes_case_id`, the self-FK.

## 3. SQL database implementation – DDL with constraints (4 marks)

- **Evidence:**
  - [`database/schema/claimguard_schema_v4.sql`](../database/schema/claimguard_schema_v4.sql): `CREATE TABLE` ×14, `CREATE EXTENSION`, `CREATE INDEX`, `CREATE VIEW`, `CREATE FUNCTION/TRIGGER`.
  - Migrations [`001`](../database/migrations/001_user_session_auth.sql)–[`004`](../database/migrations/004_workflow_guards.sql): `CREATE TABLE user_session`; `ALTER TABLE … ADD CONSTRAINT/COLUMN`.
  - [`database/scripts/reset_db.sql`](../database/scripts/reset_db.sql): `DROP` in dependency order, with a guard.
  - [`005_db_roles.sql`](../database/migrations/005_db_roles.sql): `CREATE ROLE`, `GRANT`, `REVOKE` (DCL).
  - In the catalog: 15 PK, 28 FK (including composite and self-referencing), 17 UNIQUE (including a partial unique index `ux_risk_rule_one_active`), 42 CHECK, and 1 deferred constraint trigger.
- **Demo:**
  - psql `\d claim` shows its CHECKs and composite FK.
  - `INSERT INTO claim (…, claimed_amount, …) VALUES (…, -5, …)` fails with `ck_claim_amount`.
  - Show `ck_assessment_failed` in `\d screening_assessment`: a FAILED attempt can't carry a risk value.

## 4. NoSQL/Vector database creation (4 marks)

- **Evidence:**
  - `CREATE EXTENSION vector` (schema v4, line 12).
  - `vector(384)` columns `reference_fraud_case.embedding` and `screening_assessment.description_embedding`.
  - The `embedding_model` registry, with `CHECK (dimension = 384)`.
  - A non-zero-vector CHECK (`ck_ref_case_embedding_nonzero`).
  - The **HNSW index** `ix_ref_case_embedding_hnsw … USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64) WHERE is_active AND is_confirmed`.
  - Data: [`database/seed/claimguard_reference_cases_v2.sql`](../database/seed/claimguard_reference_cases_v2.sql), 18 cases with real all-MiniLM-L6-v2 embeddings, generated by [`embedding-service/scripts/generate_reference_seed.py`](../embedding-service/scripts/generate_reference_seed.py).
- **Demo:**
  - psql `\dx vector` and `\d reference_fraud_case` (shows the `vector(384)` column and the hnsw index).
  - `SELECT title, vector_dims(embedding) FROM reference_fraud_case LIMIT 3;` returns 384.

## 5. Technology justification (1 mark)

- **Evidence:** README §Database choice and justification covers:
  - PostgreSQL for structured ACID data that depends on its constraints
  - pgvector for semantic search
  - why one engine instead of a separate vector database: the same transaction for claim, assessment and matches, and real FKs from matches to reference cases
- **Demo:** read the three bullet points about why one engine instead of a separate vector database. Then show `sp_screen_claim` writing the assessment and matches in one transaction (migration 002, lines 91–242).

## 6. DML operations (4 marks)

- **Evidence:**
  - **INSERT:**
    - the seed files
    - `POST /api/claims` ([`api/claims/route.ts`](../backend/app/api/claims/route.ts))
    - `INSERT … SELECT` in [§H1](../database/queries/claimguard_queries_v1.sql)
    - review, decision and notification inserts inside `sp_decide_claim`
    - policy issue ([`api/admin/policies/route.ts`](../backend/app/api/admin/policies/route.ts))
  - **UPDATE:**
    - claim status transitions (seed, `sp_decide_claim`)
    - notification read/dismiss ([`api/notifications/[id]/route.ts`](../backend/app/api/notifications/[id]/route.ts), query §G14)
    - user activation ([`api/admin/users/[id]/route.ts`](../backend/app/api/admin/users/[id]/route.ts))
    - reference-case deactivation
    - session revocation ([`lib/auth.ts`](../backend/app/lib/auth.ts))
    - risk-rule activation switch (reference-case seed)
  - **DELETE:** §G14b deletes expired and revoked login sessions with `DELETE … WHERE revoked_at IS NOT NULL OR expires_at <= now() RETURNING …`, shown removing 2 rows in `execution_log.txt`. Business tables refuse DELETE on purpose (§G10: `DELETE FROM claim` is blocked by `trg_claim_no_delete`), because claims, decisions and audit history must be kept (FR-13).
- **Demo:** submit a claim in the UI (INSERT); mark a notification read (UPDATE); run §G14b in psql (2 dead sessions deleted, `RETURNING` shows them); run §G10 (DELETE of a claim refused, history preserved).

## 7. Nested, correlated, recursive queries, JOIN queries (4 marks)

All in [`database/queries/claimguard_queries_v1.sql`](../database/queries/claimguard_queries_v1.sql); the
output of a full run is in [`execution_log.txt`](../database/queries/execution_log.txt).

| Kind | Queries |
|---|---|
| Nested (non-correlated) | D2 (`NOT IN (SELECT …)`), D4 (`HAVING COUNT(*) > (SELECT AVG(…) FROM (subquery))`), D5 (`IN (… GROUP BY … HAVING)`), D3 (derived table) |
| Correlated | D1 (`NOT EXISTS`), D6 (correlated `EXISTS` + scalar subquery), **D7** (matches above that case's own average, labelled) |
| Recursive | **E4** (`WITH RECURSIVE` month series), version chain in [`lib/referenceCases.ts`](../backend/app/lib/referenceCases.ts) and the Python test "second revision" |
| JOIN | B1 (`LEFT JOIN LATERAL`), B2–B6 (multi-table inner/left joins), E2 (self-join co-occurrence), G5 (join with vector distance) |

- **Demo:** run D7 and E4 from the file in psql. D7 returns matches above the per-case average; E4 lists every month, including any with zero claims.

## 8. Advanced SQL – procedure/function, trigger, CTE (6 marks)

- **Procedures:** `sp_screen_claim`, `sp_decide_claim` ([migration 002](../database/migrations/002_risk_rule_fk_and_procedure.sql)), `sp_revise_reference_case` ([migration 003](../database/migrations/003_reference_case_versioning.sql)). All use INOUT parameters, row locks and exception blocks.
- **Functions:** `fn_compute_claim_risk`, `fn_assert_approvable` (extended in [004](../database/migrations/004_workflow_guards.sql)), `fn_session_principal`, `fn_user_has_role`, plus 30+ trigger functions.
- **Triggers (56):**
  - state machine (`trg_claim_state_guard`)
  - immutability and append-only guards
  - role checks (`trg_review_reviewer_role`)
  - `trg_high_risk_flag`
  - audit writers
  - `trg_information_response_guard`
  - `trg_user_status_guard`
  - a deferred constraint trigger (`trg_assessment_matches_present`)
- **CTEs:** E1–E5 (including recursive E4); app queries use CTEs and `WITH RECURSIVE` (`lib/referenceCases.ts`).
- **Transactions:** query §H2/H3 prove all-or-nothing and `ROLLBACK`; the app wraps `CALL sp_*` in `BEGIN/COMMIT/ROLLBACK`.
- **Demo:**
  - psql `CALL sp_decide_claim('d1000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000003','APPROVED','try');`. The trigger-backed guard refuses with *"approval blocked: an information request on this HIGH-risk claim is still unanswered"*.
  - Then run §H3 (`BEGIN; CALL …; ROLLBACK;`): audit rows go 3 → 5 → 3.

## 9. NoSQL/Vector feature, RUD (7 marks) ⚠

| Operation | Implementation | Where |
|---|---|---|
| **Read** (similarity search) | Top-k by cosine distance `ORDER BY embedding <=> $q LIMIT k`, HNSW index, same model only | `/similar` page + `GET /api/similar` ([`lib/similarity.ts`](../backend/app/lib/similarity.ts)); automatic screening in `sp_screen_claim`; query §G5 |
| **Read** (by id / list / keyword) | Case details, version chain, full-text search over cases | `/admin/reference-cases`, `GET /api/reference-cases[/id]` ([`lib/referenceCases.ts`](../backend/app/lib/referenceCases.ts)) |
| **Create** | Embed the description, then insert the vector | `POST /api/reference-cases`; seed v2 |
| **Update** | Edit title/description → **re-embedded new version** via `sp_revise_reference_case` (old row deactivated, new row `supersedes_case_id` = old) | `PATCH /api/reference-cases/[id]`, edit form on `/admin/reference-cases/[id]`; bulk re-embed: [`reembed_reference_cases.py`](../embedding-service/scripts/reembed_reference_cases.py) |
| **Delete** | **Soft delete**: one-way deactivation removes the vector from every search (the HNSW index is partial on `is_active`) | `POST /api/reference-cases/[id]/deactivate`, Deactivate button |

- **Demo:**
  1. On `/similar`, click *Use an example* and *Find similar cases* (Read).
  2. On `/admin/reference-cases`, open a case, change its description and save. The version history shows the old and new versions (Update, re-embedded).
  3. Deactivate the case.
  4. Re-run the same `/similar` search: the case no longer appears (Delete).
- **Weakness:** see [Weak or missing](#weak-or-missing) item B.

## 10. Next.js interface (3 marks)

- **Pages** (screenshots in [`docs/screenshots/`](screenshots/)):
  - `/login`
  - Policyholder: `/my-claims`, `/my-claims/new`, `/my-claims/[id]` (timeline + answer form), `/notifications`
  - Adjuster: `/` dashboard, `/adjuster/queue` (filters, sort, full-text search), `/adjuster/claims/[id]` (evidence + Approve/Reject/Request info), `/similar`
  - Admin: `/admin` (reports), `/admin/reference-cases` (list/new/edit), `/admin/audit`, `/admin/policies`, `/admin/users`
- **Behaviour:** role-specific navigation, loading/empty/error states, and database errors shown as plain messages.
- **Demo:** sign in as each role and show that the navigation changes, then walk through the adjuster claim page.

## 11. Backend/API and database integration (2 marks)

- **Evidence:**
  - Next.js route handlers under [`backend/app/api/`](../backend/app/api/), using a shared `pg` pool ([`db/pool.ts`](../backend/app/db/pool.ts)) and parameterised SQL only.
  - Transactions with `BEGIN/COMMIT/ROLLBACK` and `set_config('claimguard.actor_id', …, true)`, so audit triggers record the actor.
  - `CALL` of the stored procedures, and database error mapping ([`lib/http.ts`](../backend/app/lib/http.ts)).
  - The embedding-service integration ([`lib/embedding.ts`](../backend/app/lib/embedding.ts)).
  - Verified by 23 API tests ([`backend/tests/api.test.mjs`](../backend/tests/api.test.mjs), [`TESTING.md`](TESTING.md)).
- **Demo:** `POST /api/claims/[id]/review` with Approve on a HIGH-risk claim. The 422 message comes straight from the database trigger.

## 12. Authentication – front end, ≥ 2 roles, RBAC in the database (4 marks)

- **Front end:** `/login` ([`login/LoginForm.tsx`](../backend/app/login/LoginForm.tsx)) and sign-out; `proxy.ts` redirects signed-out users.
- **Roles:** 3 (`app_role`: POLICYHOLDER, CLAIMS_ADJUSTER, ADMIN).
- **In the database:**
  - bcrypt hashes in `app_user`
  - `user_session` stores only the SHA-256 of the token
  - `fn_session_principal` resolves token → user → role on every request
  - `fn_user_has_role`
  - role-binding triggers: `trg_review_reviewer_role` (only active adjusters review), `trg_policy_holder_role`, `trg_ref_case_creator_role`/`_deactivator_role` (admins only), `trg_user_role_change_guard`
  - `trg_user_deactivate_revoke_sessions`
  - `trg_user_status_guard` (last admin)
- **PostgreSQL roles (migration 005):** `claimguard_app` gets SELECT/INSERT/UPDATE on the tables the app uses, INSERT-only on history tables, no DELETE except dead sessions, no TRUNCATE, no DDL, and EXECUTE on the three procedures (revoked from PUBLIC). `claimguard_readonly` can read only the reporting views. The web app connects as `claimguard_web`, a login role in `claimguard_app`. The 23 API tests pass with it, and 8 database tests check the privileges.
- **Server:** `requireRole` on every route; ownership filtered in SQL.
- **Demo:**
  - Sign in as the adjuster and open `/admin`: you are redirected.
  - In psql, `INSERT INTO review(… reviewer_id = <an ADMIN id> …)` is refused by `trg_review_reviewer_role`.
  - Deactivate a user on `/admin/users`: their open session gets 401 at once.
  - In psql, `SET ROLE claimguard_app; DELETE FROM claim;` gives *permission denied for table claim* before any trigger runs. `SET ROLE claimguard_readonly; SELECT * FROM claim;` is denied too, while `SELECT * FROM v_claim_status_summary;` works. Run `RESET ROLE;` afterwards.

## 13. Documentation, Git/GitHub (2 marks)

- **Evidence:**
  - [`README.md`](../README.md) (all sections)
  - [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md), [`TESTING.md`](TESTING.md), [`ClaimGuard_ER_and_Relational_Schema_v6.md`](ClaimGuard_ER_and_Relational_Schema_v6.md)
  - the SRS and architecture PDFs
  - Git history on GitHub with conventional commits from both members, numbered SQL migrations, and `.gitignore` excluding secrets and environments
- **Demo:** show the README contents on GitHub, then `git log --oneline` and the per-author history.

## 14. Originality, individual contribution, modification/viva (4 marks)

- **Originality:**
  - the domain design (fraud screening as *advisory* evidence with failure ≠ LOW)
  - 18 hand-written synthetic fraud patterns
  - a calibrated, versioned risk rule
  - versioned immutable reference cases
  - database-enforced HIGH-risk approval rule
- **Individual contribution:** README §Team and individual contributions, which follows the git history.
- **Modification:** see [Likely live modifications](#likely-live-modifications); practise each once on a disposable database.

## Weak or missing

**A. Item 6 – no successful DELETE. Fixed.**
- §G14b now deletes expired and revoked sessions (a real `DELETE … RETURNING`), and a database test checks that only dead sessions go.
- In the viva, explain why business records are deactivated, never deleted (FR-13).

**B. Item 9 – Update and Delete of vectors are not in place.**
- **Problem:** `fn_ref_case_immutable` and `trg_reference_fraud_case_no_delete` forbid `UPDATE … SET embedding` and `DELETE`, because past screening matches must keep pointing at the exact evidence an adjuster saw. Update is therefore a new re-embedded version, and Delete is deactivation, which removes the vector from every search.
- **Defence:** this is a deliberate, documented integrity decision, and the UI demonstrates both clearly.
- **Risk:** an examiner who expects literal `UPDATE`/`DELETE` statements on the vector column may mark it partially correct.
- **Fallback if asked:** show the procedure `sp_revise_reference_case`, the `UPDATE reference_fraud_case SET is_active=false …` it runs, and the Python tests "revision deactivates the old row…" and "second revision: WITH RECURSIVE…".

**C. Item 12 – no PostgreSQL-level roles. Fixed.**
- Migration 005 adds `claimguard_app` and `claimguard_readonly` with least-privilege GRANTs, and revokes procedure EXECUTE from PUBLIC.
- The web app runs as `claimguard_web` (a member of `claimguard_app`); the API suite passed that way.
- Row-level security was deliberately not added. The app sets `claimguard.actor_id` only inside write transactions, and triggers insert notifications for *other* users (e.g. the adjuster's decision notifies the policyholder), so an RLS policy on `notification` would block legitimate writes. Ownership is enforced in every query instead.

**D. Smaller points:**
- The semantic evaluation uses 16 synthetic sentences, with thresholds tuned on the same sample (stated in TESTING.md).
- There is no automatic background retry for stale PENDING screenings.

## Likely live modifications

Practise each on a disposable database, then rerun `database/tests/claimguard_tests_v4.py` and `npm run typecheck`.
Any schema change goes in a **new migration** (`database/migrations/005_<name>.sql`, wrapped in `BEGIN … COMMIT`), never in schema v4.
If it creates a new database object, also add its `DROP` to `database/scripts/reset_db.sql`.

**1. Add a column with a constraint.** Example: `claim.incident_location varchar(120) NOT NULL DEFAULT 'Not stated' CHECK (btrim(incident_location) <> '')`.
- **Migration:** `005_…sql`: `ALTER TABLE claim ADD COLUMN … CHECK …`. To keep claims immutable, `CREATE OR REPLACE FUNCTION fn_claim_core_immutable()` with the new column added to both tuples.
- **API:** `backend/app/api/claims/route.ts`: validate the field and add it to the `INSERT`.
- **Form:** `backend/app/my-claims/NewClaimForm.tsx`: add an input.
- **Display:** `backend/app/lib/claims.ts` (add to SELECT and `ClaimDetail`), then `backend/app/my-claims/[id]/page.tsx` and `backend/app/adjuster/claims/[id]/page.tsx`.

**2. A new view.** Example: `v_policyholder_claim_summary` (claims, total amount and approvals per policyholder, GROUP BY with FILTER, like query C5).
- **Migration:** `005_…sql`: `CREATE VIEW …`.
- **Reset script:** `reset_db.sql`: `DROP VIEW IF EXISTS …` in the views block.
- **Admin page:** `backend/app/admin/page.tsx`: add one `pool.query` to the `Promise.all`, and one `<Card view="v_policyholder_claim_summary">` with a table.

**3. Change top-k.** Three places, depending on what is asked:
- **Screening:** set `SCREENING_TOP_K=3` in `backend/.env.local` (read in `backend/app/lib/screening.ts`, clamped 1–40; `sp_screen_claim` accepts up to 1000 and raises `hnsw.ef_search` above 40).
- **Similarity page:** the `k` options `[3, 5, 10]` in `backend/app/similar/SimilarSearch.tsx`, and the 1–20 limit in `backend/app/api/similar/route.ts`.
- **SQL default:** `p_top_k integer DEFAULT 3` in `sp_screen_claim` (`CREATE OR REPLACE PROCEDURE` in a new migration).

New screenings record their `top_k` in `screening_assessment.top_k`.

**4. Add a filter.** Example: claimed-amount range on the review queue.
- **Query:** `backend/app/lib/queue.ts`: add `minAmount`/`maxAmount` to `QueueFilters`, plus `AND ($7::numeric IS NULL OR q.claimed_amount >= $7) AND ($8::numeric IS NULL OR q.claimed_amount <= $8)` and the two parameters.
- **Page:** `backend/app/adjuster/queue/page.tsx`: parse `min`/`max` from `searchParams` (number check) and add two `<input type="number">` to the GET form.

Alternative: a model filter on `/admin/reference-cases`, in `lib/referenceCases.ts`, `api/reference-cases/route.ts` and `ReferenceCasesTable.tsx`.

**5. A new trigger.** Example: notify every active adjuster when a claim becomes `review_required`.
- **Migration:** `005_…sql`: `CREATE FUNCTION fn_notify_adjusters_high_risk()` that runs `INSERT INTO notification (user_id, claim_id, notification_type, message) SELECT u.user_id, NEW.claim_id, 'HIGH_RISK_FLAGGED', … FROM app_user u JOIN app_role r USING (role_id) WHERE r.role_name='CLAIMS_ADJUSTER' AND u.is_active`. Then `CREATE TRIGGER trg_notify_high_risk AFTER UPDATE OF review_required ON claim FOR EACH ROW WHEN (NOT OLD.review_required AND NEW.review_required) EXECUTE FUNCTION …`.
- **Reset script:** `reset_db.sql`: `DROP FUNCTION IF EXISTS fn_notify_adjusters_high_risk();`.
- **App:** no change needed; notifications appear on `/notifications`.
- **Check:** submit a paraphrased fraud claim; the adjuster's notification badge goes up.

If a new trigger writes to `audit_log` with a **new action name**, it must also `ALTER TABLE audit_log DROP CONSTRAINT ck_audit_action, ADD CONSTRAINT ck_audit_action CHECK (action IN (…, 'NEW_ACTION'))`, and extend `ck_audit_action_target`.

**Bonus (no code):** "make the HIGH threshold stricter". Insert a new rule version and switch the active one, with no UPDATE of old assessments (BR-06):
`INSERT INTO risk_rule (rule_version, definition, is_active, created_by) VALUES ('v2.1', '{"high_similarity_threshold":0.70,"medium_similarity_threshold":0.58}', false, 'a1000000-0000-0000-0000-000000000001'); UPDATE risk_rule SET is_active = false WHERE is_active; UPDATE risk_rule SET is_active = true WHERE rule_version = 'v2.1';`
