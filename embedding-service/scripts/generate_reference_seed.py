"""Generates database/seed/claimguard_reference_cases_v2.sql from data/reference_cases.json.

Each description is embedded with the real model (embedder.py), and the vector is written
into the SQL file. The result is a plain SQL seed that anyone can load with psql, without
Python or the model installed.

Run from embedding-service/:
    .venv\\Scripts\\python scripts\\generate_reference_seed.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVICE_DIR = HERE.parent
sys.path.insert(0, str(SERVICE_DIR))

import embedder  # noqa: E402

REPO_ROOT = SERVICE_DIR.parent
DATA_FILE = SERVICE_DIR / "data" / "reference_cases.json"
OUT_FILE = REPO_ROOT / "database" / "seed" / "claimguard_reference_cases_v2.sql"

# Seed admin who "creates" the cases (must be an active ADMIN: trg_ref_case_creator_role).
SEED_ADMIN_ID = "a1000000-0000-0000-0000-000000000001"

RULE_VERSION = "v2.0-minilm"
RULE_DEFINITION = {
    "high_similarity_threshold": 0.65,
    "medium_similarity_threshold": 0.55,
    "description": "Calibrated for sentence-transformers/all-MiniLM-L6-v2 (normalized-v1) on the synthetic calibration sample",
}


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    cases = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    vectors = embedder.embed_texts([c["description"] for c in cases])

    model = f"(SELECT model_id FROM embedding_model WHERE model_name = {sql_text(embedder.MODEL_NAME)} " \
            f"AND model_version = {sql_text(embedder.MODEL_VERSION)})"

    lines = [
        "-- =============================================================================",
        "-- ClaimGuard reference fraud cases v2: real sentence embeddings",
        "-- GENERATED FILE: do not edit by hand. Source: embedding-service/data/reference_cases.json",
        "-- Regenerate: embedding-service\\.venv\\Scripts\\python embedding-service\\scripts\\generate_reference_seed.py",
        "--",
        f"-- Model: {embedder.MODEL_NAME} ({embedder.MODEL_VERSION}), {embedder.DIMENSION} dims, L2-normalised.",
        f"-- {len(cases)} synthetic, confirmed fraud patterns. Not real people or real claims.",
        "--",
        "-- Apply after claimguard_seed_v1.sql and migration 003 (so the audit trigger records them).",
        "-- Safe to re-run: existing model and case rows are skipped (ON CONFLICT DO NOTHING).",
        "-- =============================================================================",
        "BEGIN;",
        "",
        "INSERT INTO embedding_model (model_name, model_version, dimension)",
        f"VALUES ({sql_text(embedder.MODEL_NAME)}, {sql_text(embedder.MODEL_VERSION)}, {embedder.DIMENSION})",
        "ON CONFLICT (model_name, model_version) DO NOTHING;",
        "",
        "-- Risk rule calibrated for this model (scripts/calibrate_thresholds.py): on the synthetic",
        "-- sample, fraud-like paraphrases scored 0.57-0.81 against their pattern, ordinary claims",
        "-- 0.37-0.57. v1.1 (0.80 / 0.60) was tuned for the old placeholder vectors.",
        "-- Past assessments keep the rule version they were scored with (FK, migration 002).",
        "INSERT INTO risk_rule (rule_version, definition, is_active, created_by)",
        f"VALUES ({sql_text(RULE_VERSION)},",
        f"        '{json.dumps(RULE_DEFINITION)}'::jsonb,",
        f"        false, {sql_text(SEED_ADMIN_ID)})",
        "ON CONFLICT (rule_version) DO NOTHING;",
        "-- Only one rule may be active (ux_risk_rule_one_active): switch in two steps.",
        f"UPDATE risk_rule SET is_active = false WHERE is_active AND rule_version <> {sql_text(RULE_VERSION)};",
        f"UPDATE risk_rule SET is_active = true  WHERE rule_version = {sql_text(RULE_VERSION)};",
        "",
    ]
    for case, vector in zip(cases, vectors):
        lines += [
            f"-- {case['title']}",
            "INSERT INTO reference_fraud_case",
            "  (case_id, title, description, is_confirmed, is_active, embedding_model_id, embedding, created_by)",
            "VALUES (",
            f"  {sql_text(case['case_id'])},",
            f"  {sql_text(case['title'])},",
            f"  {sql_text(case['description'])},",
            f"  true, true, {model},",
            f"  '{embedder.to_pgvector(vector)}'::vector,",
            f"  {sql_text(SEED_ADMIN_ID)})",
            "ON CONFLICT (case_id) DO NOTHING;",
            "",
        ]
    lines += ["COMMIT;", ""]
    OUT_FILE.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"wrote {len(cases)} cases to {OUT_FILE.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
