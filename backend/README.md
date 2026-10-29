# Backend — building geometry case study

FastAPI + uv + async psycopg. The backend exposes a health check, has database
plumbing wired, and provides a pure site geometry foundation. Massing and option
persistence remain planned; see [the design note](../docs/DESIGN.md).

## Stack

- **[uv](https://docs.astral.sh/uv/)** — package manager
- **FastAPI** — HTTP API under `/api/v1/`
- **pydantic-settings** — config from env vars (`APP_` prefix)
- **psycopg (async) + connection pool** — DB access (pool wired, no schema; you write raw SQL)
- **Typer** — CLI (`serve`, `generate-openapi`)
- **Ruff** + **Pyright** — lint/format + type check

## Getting started

```bash
cp .env.example .env
uv sync --group dev
uv run app serve --reload        # http://localhost:8000  (docs at /docs)
```

A Postgres is expected at `APP_DATABASE_URL`. The easiest way is the root
`docker compose up` (brings up db + backend + frontend together).

## What's here / what's yours

- `app/server.py` — FastAPI app, CORS, lifespan; creates + opens the DB connection pool.
- `app/db.py` — async psycopg pool + `get_connection` dependency. **No ORM, no schema** — define
  your own model types and write pure SQL.
- `app/v1/routes/health.py` — `GET /api/v1/health`.
- `app/geometry/site.py` — pure Polygon validation, canonical serialization, and site
  area measurement with Shapely. No HTTP or database dependency.

You own: the domain model, the algorithm, the persistence schema (saved options +
the decision tree), migrations, the API contract, and tests.

## Commands

```bash
uv run pytest                              # tests
uv run pytest --cov=app --cov-report=term-missing
uv run ruff check . && uv run ruff format .
uv run pyright
uv run app generate-openapi                # -> docs/openapi.json
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `APP_LOG_LEVEL` | `INFO` | Logging level |
| `APP_DEBUG` | `false` | FastAPI debug mode |
| `APP_ALLOWED_ORIGINS` | `*` | CORS origins, semicolon-separated |
| `APP_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/casestudy` | libpq connection string (psycopg) |
