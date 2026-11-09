"""Re-embeds every active reference fraud case with the real model.

Why this does not UPDATE the vector:
    fn_ref_case_immutable (schema v4) forbids changing a reference case's embedding, model,
    title or description, because existing screening_match rows point at that exact evidence.
    Instead, each active case that is not yet on the real model is replaced by a new version
    with sp_revise_reference_case (migration 003): the old row is deactivated, a new row with
    the same text, the real vector and supersedes_case_id = old id is inserted, and both
    steps are audited. History stays intact, and new screenings only see the new versions.

Also makes sure the embedding_model row for this model/version exists.
Everything runs in ONE transaction: either every case is re-embedded or none is.

Usage (from embedding-service/, DATABASE_URL set in the environment, never printed):
    .venv\\Scripts\\python scripts\\reembed_reference_cases.py --dry-run
    .venv\\Scripts\\python scripts\\reembed_reference_cases.py
Optional: CLAIMGUARD_ADMIN_EMAIL=<admin email> (defaults to the first active ADMIN).
Requires migrations 002 and 003.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg  # noqa: E402

import embedder  # noqa: E402


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # titles contain em dashes
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="show what would change, then roll back")
    args = parser.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        # 1. Register the model (idempotent).
        cur.execute(
            """INSERT INTO embedding_model (model_name, model_version, dimension)
               VALUES (%s, %s, %s)
               ON CONFLICT (model_name, model_version) DO NOTHING""",
            (embedder.MODEL_NAME, embedder.MODEL_VERSION, embedder.DIMENSION),
        )
        cur.execute(
            "SELECT model_id FROM embedding_model WHERE model_name = %s AND model_version = %s",
            (embedder.MODEL_NAME, embedder.MODEL_VERSION),
        )
        model_id = cur.fetchone()[0]
        print(f"embedding_model {embedder.MODEL_NAME} ({embedder.MODEL_VERSION}) -> model_id {model_id}")

        # 2. Admin who performs the change (role is enforced again by the triggers).
        cur.execute(
            """SELECT u.user_id, u.email FROM app_user u JOIN app_role r USING (role_id)
               WHERE r.role_name = 'ADMIN' AND u.is_active
                 AND (%s::text IS NULL OR lower(u.email) = lower(%s::text))
               ORDER BY u.created_at LIMIT 1""",
            (os.environ.get("CLAIMGUARD_ADMIN_EMAIL"),) * 2,
        )
        row = cur.fetchone()
        if row is None:
            print("No matching active ADMIN user found.", file=sys.stderr)
            return 2
        admin_id, admin_email = row
        print(f"acting as {admin_email}")

        # 3. Active cases still on another model.
        cur.execute(
            """SELECT case_id, title, description FROM reference_fraud_case
               WHERE is_active AND embedding_model_id <> %s
               ORDER BY created_at, case_id""",
            (model_id,),
        )
        cases = cur.fetchall()
        if not cases:
            print("All active reference cases already use this model. Nothing to do.")
            return 0

        vectors = embedder.embed_texts([c[2] for c in cases])
        for (case_id, title, description), vector in zip(cases, vectors):
            cur.execute(
                "CALL sp_revise_reference_case(%s, %s, %s, %s, %s, %s::vector, NULL)",
                (case_id, admin_id, title, description, model_id, embedder.to_pgvector(vector)),
            )
            new_id = cur.fetchone()[0]
            print(f"  {case_id} -> {new_id}  {title}")

        if args.dry_run:
            conn.rollback()
            print(f"dry run: {len(cases)} case(s) would be re-embedded; rolled back.")
        else:
            conn.commit()
            print(f"re-embedded {len(cases)} case(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
