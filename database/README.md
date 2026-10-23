# Database

## Organization

- `schema/` — canonical schema and database object definitions.
- `migrations/` — ordered incremental schema changes.
- `seeds/` — synthetic development/test data only.
- `queries/` — reusable and analytical SQL.
- `tests/` — database-level validation scripts.

Do not store real insurance claimant data or credentials in this directory.
Document database engine and extension versions before running scripts.
