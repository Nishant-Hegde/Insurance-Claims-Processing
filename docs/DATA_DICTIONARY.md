# ClaimGuard data dictionary

Every table, column, type and constraint of the ClaimGuard database after `claimguard_schema_v4.sql`
and migrations 001–004. Types, nullability, defaults, constraints, indexes and trigger names were read
from the PostgreSQL 16 catalog of a database built with the documented apply order; the *Meaning*
column is the project's own description. The SQL files remain the source of truth.

Conventions: all keys are surrogate keys (`uuid` with `gen_random_uuid()`, or identity integers).
`vector(384)` is the pgvector type. *Null* = `yes` means the column is optional.

| Table | Purpose |
|---|---|
| [`app_role`](#app_role) | Fixed vocabulary of the three roles. Seeded by the schema; a user has exactly one role. |
| [`app_user`](#app_user) | Every person who signs in. Users are deactivated, never deleted, so history keeps pointing at them. |
| [`user_session`](#user_session) | Server-side login sessions (migration 001). The browser holds a random token; only its SHA-256 hash is stored. |
| [`policy`](#policy) | Insurance coverage issued by an admin to one policyholder for a date range. |
| [`claim`](#claim) | A claim filed by the policyholder of a policy. Its submitted content is immutable; status moves through a guarded state machine. |
| [`embedding_model`](#embedding_model) | Registry of embedding models. Vectors are only ever compared within one model. |
| [`reference_fraud_case`](#reference_fraud_case) | Confirmed synthetic fraud patterns with their description embedding. Immutable after insert; edits create a new linked version (migration 003). |
| [`risk_rule`](#risk_rule) | Versioned thresholds that turn the best similarity score into an advisory risk level. At most one rule is active. |
| [`screening_assessment`](#screening_assessment) | One screening attempt for a claim: COMPLETED with an outcome and risk, or FAILED with a reason. Append-only. |
| [`screening_match`](#screening_match) | Ranked top-k reference cases returned by a COMPLETED screening, with their cosine similarity. Append-only. |
| [`review`](#review) | An adjuster action on a claim (approve, reject, request information) with notes. Append-only. |
| [`information_response`](#information_response) | The policyholder's answer to an INFO_REQUESTED review. Append-only; guarded by migration 004. |
| [`claim_decision`](#claim_decision) | The single final decision for a claim; mirrors the deciding review. Append-only. |
| [`notification`](#notification) | Per-user inbox entries. Content is immutable; only read/dismiss state changes. |
| [`audit_log`](#audit_log) | Append-only event history written by triggers in the same transaction as each change. |

## app_role

Fixed vocabulary of the three roles. Seeded by the schema; a user has exactly one role.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `role_id` | `smallint` | no | `identity` | Surrogate key |
| `role_name` | `character varying(30)` | no |  | POLICYHOLDER, CLAIMS_ADJUSTER or ADMIN |

**Constraints**

- `ck_app_role_name` (CHECK): `CHECK (((role_name)::text = ANY ((ARRAY['POLICYHOLDER'::character varying, 'CLAIMS_ADJUSTER'::character varying, 'ADMIN'::character varying])::text[])))`
- `app_role_pkey` (PRIMARY KEY): `PRIMARY KEY (role_id)`
- `app_role_role_name_key` (UNIQUE): `UNIQUE (role_name)`

**Indexes**

- `app_role_pkey`: `CREATE UNIQUE INDEX app_role_pkey ON app_role (role_id)`
- `app_role_role_name_key`: `CREATE UNIQUE INDEX app_role_role_name_key ON app_role (role_name)`

## app_user

Every person who signs in. Users are deactivated, never deleted, so history keeps pointing at them.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `user_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `role_id` | `smallint` | no |  | The user's role |
| `email` | `character varying(254)` | no |  | Sign-in email; unique case-insensitively (ux_app_user_email) |
| `password_hash` | `character varying(255)` | no |  | bcrypt hash of the password; never plaintext |
| `full_name` | `character varying(120)` | no |  | Display name |
| `is_active` | `boolean` | no | `true` | false = deactivated: cannot sign in, sessions revoked |
| `created_at` | `timestamp with time zone` | no | `now()` | When the account was created |

**Constraints**

- `ck_app_user_email` (CHECK): `CHECK ((POSITION(('@'::text) IN (email)) > 1))`
- `ck_app_user_hash` (CHECK): `CHECK ((btrim((password_hash)::text) <> ''::text))`
- `ck_app_user_name` (CHECK): `CHECK ((btrim((full_name)::text) <> ''::text))`
- `app_user_role_id_fkey` (FOREIGN KEY): `FOREIGN KEY (role_id) REFERENCES app_role(role_id) ON DELETE RESTRICT`
- `app_user_pkey` (PRIMARY KEY): `PRIMARY KEY (user_id)`

**Indexes**

- `app_user_pkey`: `CREATE UNIQUE INDEX app_user_pkey ON app_user (user_id)`
- `ix_app_user_role`: `CREATE INDEX ix_app_user_role ON app_user (role_id)`
- `ux_app_user_email`: `CREATE UNIQUE INDEX ux_app_user_email ON app_user (lower((email)::text))`

**Triggers**: `trg_app_user_no_delete`, `trg_app_user_no_truncate`, `trg_user_deactivate_revoke_sessions`, `trg_user_role_change_guard`, `trg_user_status_audit`, `trg_user_status_guard`

## user_session

Server-side login sessions (migration 001). The browser holds a random token; only its SHA-256 hash is stored.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `session_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `user_id` | `uuid` | no |  | Session owner |
| `token_hash` | `character(64)` | no |  | SHA-256 (hex) of the cookie token |
| `created_at` | `timestamp with time zone` | no | `now()` | Sign-in time |
| `expires_at` | `timestamp with time zone` | no |  | Hard expiry, at most 7 days after creation |
| `revoked_at` | `timestamp with time zone` | yes |  | Set on sign-out or user deactivation; NULL while live |
| `user_agent` | `character varying(300)` | yes |  | Browser user agent, for the admin sessions view |

**Constraints**

- `ck_session_expiry` (CHECK): `CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '7 days'::interval))))`
- `ck_session_revoked` (CHECK): `CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at)))`
- `ck_session_token_hash` (CHECK): `CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))`
- `user_session_user_id_fkey` (FOREIGN KEY): `FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `user_session_pkey` (PRIMARY KEY): `PRIMARY KEY (session_id)`
- `user_session_token_hash_key` (UNIQUE): `UNIQUE (token_hash)`

**Indexes**

- `ix_user_session_live`: `CREATE INDEX ix_user_session_live ON user_session (expires_at) WHERE (revoked_at IS NULL)`
- `ix_user_session_user`: `CREATE INDEX ix_user_session_user ON user_session (user_id)`
- `user_session_pkey`: `CREATE UNIQUE INDEX user_session_pkey ON user_session (session_id)`
- `user_session_token_hash_key`: `CREATE UNIQUE INDEX user_session_token_hash_key ON user_session (token_hash)`

**Triggers**: `trg_session_insert_guard`, `trg_session_update_guard`

## policy

Insurance coverage issued by an admin to one policyholder for a date range.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `policy_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `policy_number` | `character varying(40)` | no |  | Human-readable unique number (e.g. POL-2026-0001) |
| `holder_id` | `uuid` | no |  | Policyholder who owns the policy |
| `effective_date` | `date` | no |  | First day of coverage |
| `expiry_date` | `date` | no |  | Last day of coverage |
| `is_active` | `boolean` | no | `true` | Inactive policies cannot receive claims |
| `created_at` | `timestamp with time zone` | no | `now()` | Issue time |

**Constraints**

- `ck_policy_dates` (CHECK): `CHECK ((expiry_date > effective_date))`
- `policy_holder_id_fkey` (FOREIGN KEY): `FOREIGN KEY (holder_id) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `policy_pkey` (PRIMARY KEY): `PRIMARY KEY (policy_id)`
- `policy_policy_number_key` (UNIQUE): `UNIQUE (policy_number)`
- `uq_policy_id_holder` (UNIQUE): `UNIQUE (policy_id, holder_id)`

**Indexes**

- `ix_policy_holder`: `CREATE INDEX ix_policy_holder ON policy (holder_id)`
- `policy_pkey`: `CREATE UNIQUE INDEX policy_pkey ON policy (policy_id)`
- `policy_policy_number_key`: `CREATE UNIQUE INDEX policy_policy_number_key ON policy (policy_number)`
- `uq_policy_id_holder`: `CREATE UNIQUE INDEX uq_policy_id_holder ON policy (policy_id, holder_id)`

**Triggers**: `trg_policy_holder_role`, `trg_policy_issuance_audit`, `trg_policy_no_delete`, `trg_policy_no_truncate`

## claim

A claim filed by the policyholder of a policy. Its submitted content is immutable; status moves through a guarded state machine.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `claim_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `policy_id` | `uuid` | no |  | Policy the claim is filed against |
| `claimant_id` | `uuid` | no |  | Policyholder filing the claim; must be the policy holder |
| `incident_date` | `date` | no |  | Date of the incident; inside coverage and not in the future |
| `claimed_amount` | `numeric(12,2)` | no |  | Amount claimed in INR, greater than 0 |
| `description` | `text` | no |  | Free-text incident description; this text is embedded for screening |
| `claim_status` | `character varying(20)` | no | `'SUBMITTED'::character varying` | SUBMITTED, UNDER_REVIEW, AWAITING_INFO or DECIDED |
| `screening_status` | `character varying(10)` | no | `'PENDING'::character varying` | PENDING, COMPLETED or FAILED; maintained only by screening inserts |
| `review_required` | `boolean` | no | `false` | Set by trigger when a screening is HIGH risk; human review required |
| `submitted_at` | `timestamp with time zone` | no | `now()` | Submission time |
| `updated_at` | `timestamp with time zone` | no | `now()` | Last status change (set by trigger) |

**Constraints**

- `ck_claim_amount` (CHECK): `CHECK ((claimed_amount > (0)::numeric))`
- `ck_claim_description` (CHECK): `CHECK ((btrim(description) <> ''::text))`
- `ck_claim_screening_status` (CHECK): `CHECK (((screening_status)::text = ANY ((ARRAY['PENDING'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying])::text[])))`
- `ck_claim_status` (CHECK): `CHECK (((claim_status)::text = ANY ((ARRAY['SUBMITTED'::character varying, 'UNDER_REVIEW'::character varying, 'AWAITING_INFO'::character varying, 'DECIDED'::character varying])::text[])))`
- `fk_claim_policy_owner` (FOREIGN KEY): `FOREIGN KEY (policy_id, claimant_id) REFERENCES policy(policy_id, holder_id) ON DELETE RESTRICT`
- `claim_pkey` (PRIMARY KEY): `PRIMARY KEY (claim_id)`

**Indexes**

- `claim_pkey`: `CREATE UNIQUE INDEX claim_pkey ON claim (claim_id)`
- `ix_claim_claimant_submitted`: `CREATE INDEX ix_claim_claimant_submitted ON claim (claimant_id, submitted_at DESC)`
- `ix_claim_description_fts`: `CREATE INDEX ix_claim_description_fts ON claim USING gin (to_tsvector('english'::regconfig, description))`
- `ix_claim_policy`: `CREATE INDEX ix_claim_policy ON claim (policy_id)`
- `ix_claim_queue`: `CREATE INDEX ix_claim_queue ON claim (claim_status, screening_status, submitted_at)`

**Triggers**: `trg_claim_audit`, `trg_claim_core_immutable`, `trg_claim_insert_guard`, `trg_claim_no_delete`, `trg_claim_no_truncate`, `trg_claim_state_guard`

## embedding_model

Registry of embedding models. Vectors are only ever compared within one model.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `model_id` | `integer` | no | `identity` | Surrogate key |
| `model_name` | `character varying(120)` | no |  | Model identifier, e.g. sentence-transformers/all-MiniLM-L6-v2 |
| `model_version` | `character varying(60)` | no |  | Pipeline version, e.g. normalized-v1 |
| `dimension` | `integer` | no |  | Vector size; must be 384 to match vector(384) |
| `created_at` | `timestamp with time zone` | no | `now()` | Registration time |

**Constraints**

- `ck_embedding_model_dim` (CHECK): `CHECK ((dimension = 384))`
- `embedding_model_pkey` (PRIMARY KEY): `PRIMARY KEY (model_id)`
- `uq_embedding_model` (UNIQUE): `UNIQUE (model_name, model_version)`

**Indexes**

- `embedding_model_pkey`: `CREATE UNIQUE INDEX embedding_model_pkey ON embedding_model (model_id)`
- `uq_embedding_model`: `CREATE UNIQUE INDEX uq_embedding_model ON embedding_model (model_name, model_version)`

## reference_fraud_case

Confirmed synthetic fraud patterns with their description embedding. Immutable after insert; edits create a new linked version (migration 003).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `case_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `title` | `character varying(150)` | no |  | Short name of the pattern |
| `description` | `text` | no |  | Pattern text; this is what gets embedded |
| `is_confirmed` | `boolean` | no | `true` | Only confirmed cases are eligible for matching |
| `is_active` | `boolean` | no | `true` | Only active cases are searched; deactivation is one-way |
| `embedding_model_id` | `integer` | no |  | Model that produced the embedding |
| `embedding` | `vector(384)` | no |  | 384-dim L2-normalised description embedding (pgvector) |
| `created_by` | `uuid` | no |  | Admin who added the case |
| `created_at` | `timestamp with time zone` | no | `now()` | Creation time |
| `deactivated_by` | `uuid` | yes |  | Admin who deactivated it |
| `deactivated_at` | `timestamp with time zone` | yes |  | Deactivation time |
| `supersedes_case_id` | `uuid` | yes |  | Earlier version this row replaces (migration 003); NULL for an original |

**Constraints**

- `ck_ref_case_deactivation` (CHECK): `CHECK (((is_active = (deactivated_at IS NULL)) AND ((deactivated_at IS NULL) = (deactivated_by IS NULL))))`
- `ck_ref_case_description` (CHECK): `CHECK ((btrim(description) <> ''::text))`
- `ck_ref_case_embedding_nonzero` (CHECK): `CHECK ((embedding <> (array_fill(0, ARRAY[384]))::vector))`
- `ck_ref_case_supersedes_self` (CHECK): `CHECK ((supersedes_case_id IS DISTINCT FROM case_id))`
- `ck_ref_case_title` (CHECK): `CHECK ((btrim((title)::text) <> ''::text))`
- `reference_fraud_case_created_by_fkey` (FOREIGN KEY): `FOREIGN KEY (created_by) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `reference_fraud_case_deactivated_by_fkey` (FOREIGN KEY): `FOREIGN KEY (deactivated_by) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `reference_fraud_case_embedding_model_id_fkey` (FOREIGN KEY): `FOREIGN KEY (embedding_model_id) REFERENCES embedding_model(model_id) ON DELETE RESTRICT`
- `reference_fraud_case_supersedes_case_id_fkey` (FOREIGN KEY): `FOREIGN KEY (supersedes_case_id) REFERENCES reference_fraud_case(case_id) ON DELETE RESTRICT`
- `reference_fraud_case_pkey` (PRIMARY KEY): `PRIMARY KEY (case_id)`
- `uq_ref_case_id_model` (UNIQUE): `UNIQUE (case_id, embedding_model_id)`
- `uq_ref_case_supersedes` (UNIQUE): `UNIQUE (supersedes_case_id)`

**Indexes**

- `ix_ref_case_created_by`: `CREATE INDEX ix_ref_case_created_by ON reference_fraud_case (created_by)`
- `ix_ref_case_deactivated_by`: `CREATE INDEX ix_ref_case_deactivated_by ON reference_fraud_case (deactivated_by) WHERE (deactivated_by IS NOT NULL)`
- `ix_ref_case_embedding_hnsw`: `CREATE INDEX ix_ref_case_embedding_hnsw ON reference_fraud_case USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64') WHERE (is_active AND is_confirmed)`
- `ix_ref_case_fts`: `CREATE INDEX ix_ref_case_fts ON reference_fraud_case USING gin (to_tsvector('english'::regconfig, (((title)::text \|\| ' '::text) \|\| description)))`
- `ix_ref_case_model`: `CREATE INDEX ix_ref_case_model ON reference_fraud_case (embedding_model_id)`
- `reference_fraud_case_pkey`: `CREATE UNIQUE INDEX reference_fraud_case_pkey ON reference_fraud_case (case_id)`
- `uq_ref_case_id_model`: `CREATE UNIQUE INDEX uq_ref_case_id_model ON reference_fraud_case (case_id, embedding_model_id)`
- `uq_ref_case_supersedes`: `CREATE UNIQUE INDEX uq_ref_case_supersedes ON reference_fraud_case (supersedes_case_id)`

**Triggers**: `trg_ref_case_audit`, `trg_ref_case_creator_role`, `trg_ref_case_deactivator_role`, `trg_ref_case_immutable`, `trg_ref_case_lineage_immutable`, `trg_ref_case_supersede_check`, `trg_reference_fraud_case_no_delete`, `trg_reference_fraud_case_no_truncate`

## risk_rule

Versioned thresholds that turn the best similarity score into an advisory risk level. At most one rule is active.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `risk_rule_id` | `bigint` | no | `identity` | Surrogate key |
| `rule_version` | `character varying(40)` | no |  | Unique version label referenced by assessments (FK, migration 002) |
| `definition` | `jsonb` | no |  | JSON with high_similarity_threshold and medium_similarity_threshold in [0,1] |
| `is_active` | `boolean` | no | `false` | The single rule used for new screenings |
| `created_by` | `uuid` | no |  | Admin who created the rule |
| `created_at` | `timestamp with time zone` | no | `now()` | Creation time |

**Constraints**

- `ck_risk_rule_definition` (CHECK): `CHECK (((jsonb_typeof(definition) = 'object'::text) AND (definition ? 'high_similarity_threshold'::text) AND (definition ? 'medium_similarity_threshold'::text) AND ((((definition ->> 'high_similarity_threshold'::text))::numeric >= (0)::numeric) AND (((definition ->> 'high_similarity_threshold'::text))::numeric <= (1)::numeric)) AND ((((definition ->> 'medium_similarity_threshold'::text))::numeric >= (0)::numeric) AND (((definition ->> 'medium_similarity_threshold'::text))::numeric <= (1)::numeric)) AND (((definition ->> 'high_similarity_threshold'::text))::numeric >= ((definition ->> 'medium_similarity_threshold'::text))::numeric)))`
- `ck_risk_rule_version` (CHECK): `CHECK ((btrim((rule_version)::text) <> ''::text))`
- `risk_rule_created_by_fkey` (FOREIGN KEY): `FOREIGN KEY (created_by) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `risk_rule_pkey` (PRIMARY KEY): `PRIMARY KEY (risk_rule_id)`
- `risk_rule_rule_version_key` (UNIQUE): `UNIQUE (rule_version)`

**Indexes**

- `ix_risk_rule_created_by`: `CREATE INDEX ix_risk_rule_created_by ON risk_rule (created_by)`
- `risk_rule_pkey`: `CREATE UNIQUE INDEX risk_rule_pkey ON risk_rule (risk_rule_id)`
- `risk_rule_rule_version_key`: `CREATE UNIQUE INDEX risk_rule_rule_version_key ON risk_rule (rule_version)`
- `ux_risk_rule_one_active`: `CREATE UNIQUE INDEX ux_risk_rule_one_active ON risk_rule (is_active) WHERE is_active`

## screening_assessment

One screening attempt for a claim: COMPLETED with an outcome and risk, or FAILED with a reason. Append-only.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `assessment_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `claim_id` | `uuid` | no |  | Screened claim |
| `attempt_no` | `integer` | no |  | 1, 2, 3 ... per claim (retries get the next number) |
| `status` | `character varying(10)` | no |  | COMPLETED or FAILED |
| `outcome` | `character varying(15)` | yes |  | MATCHES_FOUND or NO_MATCH (COMPLETED only) |
| `risk_indicator` | `character varying(30)` | yes |  | HIGH, MEDIUM or LOW (COMPLETED only; never set on failure) |
| `risk_rule_version` | `character varying(40)` | yes |  | Rule used to compute the risk (FK to risk_rule) |
| `failure_reason` | `text` | yes |  | Why a FAILED attempt failed |
| `embedding_model_id` | `integer` | yes |  | Model of the description embedding |
| `description_embedding` | `vector(384)` | yes |  | Claim description embedding used for the search |
| `top_k` | `integer` | yes |  | How many nearest cases were requested |
| `similarity_metric` | `character varying(30)` | yes |  | How to read similarity_score (cosine_similarity) |
| `created_at` | `timestamp with time zone` | no | `now()` | Transaction time of the attempt (ties matches to the same transaction) |

**Constraints**

- `ck_assessment_attempt` (CHECK): `CHECK ((attempt_no > 0))`
- `ck_assessment_completed` (CHECK): `CHECK ((((status)::text <> 'COMPLETED'::text) OR ((outcome IS NOT NULL) AND (risk_indicator IS NOT NULL) AND (risk_rule_version IS NOT NULL) AND (embedding_model_id IS NOT NULL) AND (description_embedding IS NOT NULL) AND (top_k IS NOT NULL) AND (similarity_metric IS NOT NULL) AND (failure_reason IS NULL))))`
- `ck_assessment_embedding_nonzero` (CHECK): `CHECK (((description_embedding IS NULL) OR (description_embedding <> (array_fill(0, ARRAY[384]))::vector)))`
- `ck_assessment_failed` (CHECK): `CHECK ((((status)::text <> 'FAILED'::text) OR ((outcome IS NULL) AND (risk_indicator IS NULL) AND (risk_rule_version IS NULL) AND (failure_reason IS NOT NULL))))`
- `ck_assessment_failure_reason` (CHECK): `CHECK (((failure_reason IS NULL) OR (btrim(failure_reason) <> ''::text)))`
- `ck_assessment_outcome` (CHECK): `CHECK (((outcome)::text = ANY ((ARRAY['MATCHES_FOUND'::character varying, 'NO_MATCH'::character varying])::text[])))`
- `ck_assessment_status` (CHECK): `CHECK (((status)::text = ANY ((ARRAY['COMPLETED'::character varying, 'FAILED'::character varying])::text[])))`
- `ck_assessment_top_k` (CHECK): `CHECK ((top_k > 0))`
- `fk_assessment_risk_rule_version` (FOREIGN KEY): `FOREIGN KEY (risk_rule_version) REFERENCES risk_rule(rule_version) ON DELETE RESTRICT`
- `screening_assessment_claim_id_fkey` (FOREIGN KEY): `FOREIGN KEY (claim_id) REFERENCES claim(claim_id) ON DELETE RESTRICT`
- `screening_assessment_embedding_model_id_fkey` (FOREIGN KEY): `FOREIGN KEY (embedding_model_id) REFERENCES embedding_model(model_id) ON DELETE RESTRICT`
- `screening_assessment_pkey` (PRIMARY KEY): `PRIMARY KEY (assessment_id)`
- `trg_assessment_matches_present` (CONSTRAINT TRIGGER): `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `uq_assessment_claim_attempt` (UNIQUE): `UNIQUE (claim_id, attempt_no)`
- `uq_assessment_id_claim` (UNIQUE): `UNIQUE (assessment_id, claim_id)`
- `uq_assessment_id_model` (UNIQUE): `UNIQUE (assessment_id, embedding_model_id)`

**Indexes**

- `ix_assessment_model`: `CREATE INDEX ix_assessment_model ON screening_assessment (embedding_model_id) WHERE (embedding_model_id IS NOT NULL)`
- `screening_assessment_pkey`: `CREATE UNIQUE INDEX screening_assessment_pkey ON screening_assessment (assessment_id)`
- `uq_assessment_claim_attempt`: `CREATE UNIQUE INDEX uq_assessment_claim_attempt ON screening_assessment (claim_id, attempt_no)`
- `uq_assessment_id_claim`: `CREATE UNIQUE INDEX uq_assessment_id_claim ON screening_assessment (assessment_id, claim_id)`
- `uq_assessment_id_model`: `CREATE UNIQUE INDEX uq_assessment_id_model ON screening_assessment (assessment_id, embedding_model_id)`

**Triggers**: `trg_assessment_audit`, `trg_assessment_before_insert`, `trg_assessment_matches_present`, `trg_assessment_sync_claim`, `trg_high_risk_flag`, `trg_screening_assessment_append_only`, `trg_screening_assessment_no_truncate`

## screening_match

Ranked top-k reference cases returned by a COMPLETED screening, with their cosine similarity. Append-only.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `match_id` | `bigint` | no | `identity` | Surrogate key |
| `assessment_id` | `uuid` | no |  | Assessment that produced the match |
| `reference_case_id` | `uuid` | no |  | Matched reference case |
| `embedding_model_id` | `integer` | no |  | Must equal both the assessment's and the case's model (composite FKs) |
| `match_rank` | `integer` | no |  | 1 = most similar; contiguous 1..n |
| `similarity_score` | `double precision` | no |  | Cosine similarity = 1 - cosine distance; advisory, not a probability |

**Constraints**

- `ck_match_rank` (CHECK): `CHECK ((match_rank > 0))`
- `fk_match_assessment` (FOREIGN KEY): `FOREIGN KEY (assessment_id, embedding_model_id) REFERENCES screening_assessment(assessment_id, embedding_model_id) ON DELETE RESTRICT`
- `fk_match_reference_case` (FOREIGN KEY): `FOREIGN KEY (reference_case_id, embedding_model_id) REFERENCES reference_fraud_case(case_id, embedding_model_id) ON DELETE RESTRICT`
- `screening_match_pkey` (PRIMARY KEY): `PRIMARY KEY (match_id)`
- `uq_match_assessment_case` (UNIQUE): `UNIQUE (assessment_id, reference_case_id)`
- `uq_match_assessment_rank` (UNIQUE): `UNIQUE (assessment_id, match_rank)`

**Indexes**

- `ix_match_reference_case`: `CREATE INDEX ix_match_reference_case ON screening_match (reference_case_id)`
- `screening_match_pkey`: `CREATE UNIQUE INDEX screening_match_pkey ON screening_match (match_id)`
- `uq_match_assessment_case`: `CREATE UNIQUE INDEX uq_match_assessment_case ON screening_match (assessment_id, reference_case_id)`
- `uq_match_assessment_rank`: `CREATE UNIQUE INDEX uq_match_assessment_rank ON screening_match (assessment_id, match_rank)`

**Triggers**: `trg_match_guard`, `trg_screening_match_append_only`, `trg_screening_match_no_truncate`

## review

An adjuster action on a claim (approve, reject, request information) with notes. Append-only.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `review_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `claim_id` | `uuid` | no |  | Reviewed claim |
| `assessment_id` | `uuid` | yes |  | Screening attempt the adjuster examined (may be NULL) |
| `reviewer_id` | `uuid` | no |  | Active claims adjuster who recorded it |
| `review_action` | `character varying(15)` | no |  | APPROVED, REJECTED or INFO_REQUESTED |
| `notes` | `text` | no |  | Reasoning, or the question for the policyholder |
| `reviewed_at` | `timestamp with time zone` | no | `now()` | Review time |

**Constraints**

- `ck_review_action` (CHECK): `CHECK (((review_action)::text = ANY ((ARRAY['APPROVED'::character varying, 'REJECTED'::character varying, 'INFO_REQUESTED'::character varying])::text[])))`
- `ck_review_notes` (CHECK): `CHECK ((btrim(notes) <> ''::text))`
- `fk_review_assessment` (FOREIGN KEY): `FOREIGN KEY (assessment_id, claim_id) REFERENCES screening_assessment(assessment_id, claim_id) ON DELETE RESTRICT`
- `review_claim_id_fkey` (FOREIGN KEY): `FOREIGN KEY (claim_id) REFERENCES claim(claim_id) ON DELETE RESTRICT`
- `review_reviewer_id_fkey` (FOREIGN KEY): `FOREIGN KEY (reviewer_id) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `review_pkey` (PRIMARY KEY): `PRIMARY KEY (review_id)`
- `uq_review_claim_action` (UNIQUE): `UNIQUE (review_id, claim_id, review_action)`
- `uq_review_id_claim` (UNIQUE): `UNIQUE (review_id, claim_id)`

**Indexes**

- `ix_review_assessment`: `CREATE INDEX ix_review_assessment ON review (assessment_id, claim_id) WHERE (assessment_id IS NOT NULL)`
- `ix_review_claim`: `CREATE INDEX ix_review_claim ON review (claim_id, reviewed_at)`
- `ix_review_reviewer`: `CREATE INDEX ix_review_reviewer ON review (reviewer_id)`
- `review_pkey`: `CREATE UNIQUE INDEX review_pkey ON review (review_id)`
- `uq_review_claim_action`: `CREATE UNIQUE INDEX uq_review_claim_action ON review (review_id, claim_id, review_action)`
- `uq_review_id_claim`: `CREATE UNIQUE INDEX uq_review_id_claim ON review (review_id, claim_id)`

**Triggers**: `trg_review_append_only`, `trg_review_audit`, `trg_review_guard`, `trg_review_no_truncate`, `trg_review_reviewer_role`

## information_response

The policyholder's answer to an INFO_REQUESTED review. Append-only; guarded by migration 004.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `response_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `review_id` | `uuid` | no |  | The INFO_REQUESTED review being answered |
| `claim_id` | `uuid` | no |  | Claim of that review (composite FK) |
| `responder_id` | `uuid` | no |  | Must be the claim's policyholder (trigger, migration 004) |
| `body` | `text` | no |  | Answer text |
| `responded_at` | `timestamp with time zone` | no | `now()` | Server time of the answer |

**Constraints**

- `ck_information_response_body` (CHECK): `CHECK ((btrim(body) <> ''::text))`
- `fk_information_response_request` (FOREIGN KEY): `FOREIGN KEY (review_id, claim_id) REFERENCES review(review_id, claim_id) ON DELETE RESTRICT`
- `information_response_claim_id_fkey` (FOREIGN KEY): `FOREIGN KEY (claim_id) REFERENCES claim(claim_id) ON DELETE RESTRICT`
- `information_response_responder_id_fkey` (FOREIGN KEY): `FOREIGN KEY (responder_id) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `information_response_pkey` (PRIMARY KEY): `PRIMARY KEY (response_id)`

**Indexes**

- `information_response_pkey`: `CREATE UNIQUE INDEX information_response_pkey ON information_response (response_id)`
- `ix_information_response_claim_time`: `CREATE INDEX ix_information_response_claim_time ON information_response (claim_id, responded_at DESC)`
- `ix_information_response_responder`: `CREATE INDEX ix_information_response_responder ON information_response (responder_id, responded_at DESC)`

**Triggers**: `trg_information_response_append_only`, `trg_information_response_audit`, `trg_information_response_followup`, `trg_information_response_guard`, `trg_information_response_no_truncate`

## claim_decision

The single final decision for a claim; mirrors the deciding review. Append-only.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `decision_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `claim_id` | `uuid` | no |  | Decided claim; at most one decision per claim |
| `review_id` | `uuid` | no |  | Review that produced the decision |
| `decision_status` | `character varying(15)` | no |  | APPROVED or REJECTED; must equal the review's action |
| `decided_at` | `timestamp with time zone` | no | `now()` | Decision time |

**Constraints**

- `ck_decision_status` (CHECK): `CHECK (((decision_status)::text = ANY ((ARRAY['APPROVED'::character varying, 'REJECTED'::character varying])::text[])))`
- `fk_decision_review` (FOREIGN KEY): `FOREIGN KEY (review_id, claim_id, decision_status) REFERENCES review(review_id, claim_id, review_action) ON DELETE RESTRICT`
- `claim_decision_pkey` (PRIMARY KEY): `PRIMARY KEY (decision_id)`
- `claim_decision_claim_id_key` (UNIQUE): `UNIQUE (claim_id)`
- `claim_decision_review_id_key` (UNIQUE): `UNIQUE (review_id)`

**Indexes**

- `claim_decision_claim_id_key`: `CREATE UNIQUE INDEX claim_decision_claim_id_key ON claim_decision (claim_id)`
- `claim_decision_pkey`: `CREATE UNIQUE INDEX claim_decision_pkey ON claim_decision (decision_id)`
- `claim_decision_review_id_key`: `CREATE UNIQUE INDEX claim_decision_review_id_key ON claim_decision (review_id)`

**Triggers**: `trg_claim_decision_append_only`, `trg_claim_decision_guard`, `trg_claim_decision_no_truncate`, `trg_decision_audit`

## notification

Per-user inbox entries. Content is immutable; only read/dismiss state changes.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `notification_id` | `uuid` | no | `gen_random_uuid()` | Surrogate key |
| `user_id` | `uuid` | no |  | Recipient |
| `claim_id` | `uuid` | yes |  | Related claim, if any |
| `notification_type` | `character varying(40)` | no |  | e.g. CLAIM_APPROVED, INFO_REQUESTED, INFO_RECEIVED |
| `message` | `text` | no |  | Text shown to the user |
| `created_at` | `timestamp with time zone` | no | `now()` | Creation time |
| `read_at` | `timestamp with time zone` | yes |  | When the user read it |
| `dismissed_at` | `timestamp with time zone` | yes |  | When dismissed (requires read_at) |

**Constraints**

- `ck_notification_message` (CHECK): `CHECK ((btrim(message) <> ''::text))`
- `ck_notification_timestamps` (CHECK): `CHECK (((dismissed_at IS NULL) OR (read_at IS NOT NULL)))`
- `ck_notification_type` (CHECK): `CHECK ((btrim((notification_type)::text) <> ''::text))`
- `notification_claim_id_fkey` (FOREIGN KEY): `FOREIGN KEY (claim_id) REFERENCES claim(claim_id) ON DELETE RESTRICT`
- `notification_user_id_fkey` (FOREIGN KEY): `FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `notification_pkey` (PRIMARY KEY): `PRIMARY KEY (notification_id)`

**Indexes**

- `ix_notification_claim`: `CREATE INDEX ix_notification_claim ON notification (claim_id) WHERE (claim_id IS NOT NULL)`
- `ix_notification_inbox`: `CREATE INDEX ix_notification_inbox ON notification (user_id, created_at DESC) WHERE (dismissed_at IS NULL)`
- `notification_pkey`: `CREATE UNIQUE INDEX notification_pkey ON notification (notification_id)`

**Triggers**: `trg_notification_audit`, `trg_notification_no_delete`, `trg_notification_no_truncate`, `trg_notification_update_guard`

## audit_log

Append-only event history written by triggers in the same transaction as each change.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `audit_id` | `bigint` | no | `identity` | Surrogate key |
| `occurred_at` | `timestamp with time zone` | no | `now()` | Event time |
| `actor_type` | `character varying(6)` | no |  | USER or SYSTEM |
| `actor_id` | `uuid` | yes |  | Acting user (USER events only) |
| `action` | `character varying(40)` | no |  | Event name from a fixed vocabulary (13 actions) |
| `claim_id` | `uuid` | yes |  | Target claim (claim events) |
| `reference_case_id` | `uuid` | yes |  | Target reference case |
| `target_user_id` | `uuid` | yes |  | Target user (user, policy and notification events) |
| `assessment_id` | `uuid` | yes |  | Assessment involved; must belong to claim_id |
| `details` | `jsonb` | no | `'{}'::jsonb` | JSON context written by the trigger |

**Constraints**

- `ck_audit_action` (CHECK): `CHECK (((action)::text = ANY ((ARRAY['CLAIM_SUBMITTED'::character varying, 'SCREENING_COMPLETED'::character varying, 'SCREENING_FAILED'::character varying, 'REVIEW_RECORDED'::character varying, 'DECISION_RECORDED'::character varying, 'REFERENCE_CASE_ADDED'::character varying, 'REFERENCE_CASE_DEACTIVATED'::character varying, 'USER_CREATED'::character varying, 'USER_ROLE_CHANGED'::character varying, 'USER_STATUS_CHANGED'::character varying, 'POLICY_ISSUED'::character varying, 'INFORMATION_RESPONSE_ADDED'::character varying, 'NOTIFICATION_DISMISSED'::character varying])::text[])))`
- `ck_audit_action_target` (CHECK): `CHECK (
CASE
    WHEN ((action)::text = ANY ((ARRAY['CLAIM_SUBMITTED'::character varying, 'SCREENING_COMPLETED'::character varying, 'SCREENING_FAILED'::character varying, 'REVIEW_RECORDED'::character varying, 'DECISION_RECORDED'::character varying])::text[])) THEN (claim_id IS NOT NULL)
    WHEN ((action)::text = ANY ((ARRAY['REFERENCE_CASE_ADDED'::character varying, 'REFERENCE_CASE_DEACTIVATED'::character varying])::text[])) THEN (reference_case_id IS NOT NULL)
    WHEN ((action)::text = 'INFORMATION_RESPONSE_ADDED'::text) THEN (claim_id IS NOT NULL)
    WHEN ((action)::text = ANY ((ARRAY['POLICY_ISSUED'::character varying, 'NOTIFICATION_DISMISSED'::character varying])::text[])) THEN (target_user_id IS NOT NULL)
    ELSE (target_user_id IS NOT NULL)
END)`
- `ck_audit_actor` (CHECK): `CHECK ((((actor_type)::text = 'USER'::text) = (actor_id IS NOT NULL)))`
- `ck_audit_actor_type` (CHECK): `CHECK (((actor_type)::text = ANY ((ARRAY['USER'::character varying, 'SYSTEM'::character varying])::text[])))`
- `ck_audit_assessment` (CHECK): `CHECK (((assessment_id IS NULL) OR (claim_id IS NOT NULL)))`
- `ck_audit_one_target` (CHECK): `CHECK ((num_nonnulls(claim_id, reference_case_id, target_user_id) = 1))`
- `audit_log_actor_id_fkey` (FOREIGN KEY): `FOREIGN KEY (actor_id) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `audit_log_claim_id_fkey` (FOREIGN KEY): `FOREIGN KEY (claim_id) REFERENCES claim(claim_id) ON DELETE RESTRICT`
- `audit_log_reference_case_id_fkey` (FOREIGN KEY): `FOREIGN KEY (reference_case_id) REFERENCES reference_fraud_case(case_id) ON DELETE RESTRICT`
- `audit_log_target_user_id_fkey` (FOREIGN KEY): `FOREIGN KEY (target_user_id) REFERENCES app_user(user_id) ON DELETE RESTRICT`
- `fk_audit_assessment` (FOREIGN KEY): `FOREIGN KEY (assessment_id, claim_id) REFERENCES screening_assessment(assessment_id, claim_id) ON DELETE RESTRICT`
- `audit_log_pkey` (PRIMARY KEY): `PRIMARY KEY (audit_id)`

**Indexes**

- `audit_log_pkey`: `CREATE UNIQUE INDEX audit_log_pkey ON audit_log (audit_id)`
- `ix_audit_actor`: `CREATE INDEX ix_audit_actor ON audit_log (actor_id, occurred_at)`
- `ix_audit_claim`: `CREATE INDEX ix_audit_claim ON audit_log (claim_id, occurred_at)`
- `ix_audit_reference_case`: `CREATE INDEX ix_audit_reference_case ON audit_log (reference_case_id) WHERE (reference_case_id IS NOT NULL)`
- `ix_audit_target_user`: `CREATE INDEX ix_audit_target_user ON audit_log (target_user_id) WHERE (target_user_id IS NOT NULL)`
- `ux_audit_attempt_action`: `CREATE UNIQUE INDEX ux_audit_attempt_action ON audit_log (assessment_id, action) WHERE ((assessment_id IS NOT NULL) AND ((action)::text = ANY ((ARRAY['SCREENING_COMPLETED'::character varying, 'SCREENING_FAILED'::character varying])::text[])))`

**Triggers**: `trg_audit_log_append_only`, `trg_audit_log_no_truncate`

