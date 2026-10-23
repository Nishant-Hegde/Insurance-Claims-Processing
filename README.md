# Insurance Claims Processing

A modular repository for the Insurance Claims Processing project.

## Repository Structure

- `srs/` — Software Requirements Specification and requirement references.
- `docs/architecture/` — Architecture documents and system design.
- `docs/diagrams/` — ER diagrams, relational schema diagrams, and workflows.
- `docs/design-decisions/` — Architecture and database design decisions.
- `database/schema/` — Canonical database schema scripts.
- `database/migrations/` — Ordered database migrations.
- `database/seeds/` — Development and test seed data.
- `database/queries/` — Reusable SQL queries and reports.
- `database/tests/` — Database constraints, triggers, and function tests.
- `src/backend/` — Backend application entry points and API layer.
- `src/frontend/` — Frontend application.
- `src/shared/` — Shared contracts, types, and constants.
- `src/services/` — Business logic and service layer.
- `src/repositories/` — Data-access layer.
- `src/utils/` — Shared utility functions.
- `tests/unit/` — Unit tests.
- `tests/integration/` — Integration tests.
- `tests/acceptance/` — Requirement and workflow acceptance tests.
- `config/` — Example configuration files. Never commit secrets.
- `scripts/` — Setup, validation, and maintenance scripts.
- `assets/` — Images and exported project assets.
- `logs/` — Local log output; generated logs should not be committed.

## Development Status

Repository structure initialized. Add implementation files and verified project documentation as they become available.

## Contribution Rules

- Keep the SRS, database schema, and diagrams consistent.
- Use migrations for incremental database changes.
- Never commit passwords, tokens, private claims data, or production records.
- Record actual test outcomes; do not describe unexecuted tests as passing.
