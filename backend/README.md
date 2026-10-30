# Backend — building geometry case study

FastAPI + uv + async psycopg. The backend exposes a health check, has database
plumbing wired, and provides pure site geometry, setbacks, component selection,
deterministic default footprint construction, maximum-permitted-floor calculation,
default massing metrics, preference-aware massing integration, and target-driven GFA
assessment through a typed preview API. Root options can be saved, retrieved, and
listed as immutable PostgreSQL snapshots. Branching, comparison, alternatives, and
visualization remain planned; see
[the design note](../docs/DESIGN.md).

## Stack

- **[uv](https://docs.astral.sh/uv/)** — package manager
- **FastAPI** — HTTP API under `/api/v1/`
- **pydantic-settings** — config from env vars (`APP_` prefix)
- **psycopg (async) + connection pool** — parameterized raw SQL and JSONB snapshots
- **Typer** — CLI (`migrate`, `serve`, `generate-openapi`)
- **Ruff** + **Pyright** — lint/format + type check

## Getting started

```bash
cp .env.example .env
uv sync --group dev
uv run app migrate               # apply schema before serving option requests
uv run app serve --reload        # http://localhost:8000  (docs at /docs)
```

A Postgres is expected at `APP_DATABASE_URL`. The easiest way is the root
`docker compose up` (brings up db + backend + frontend together).

## Database setup and migrations

The database must already exist at `APP_DATABASE_URL`. Run `uv run app migrate`
before starting the backend directly. Docker Compose uses the backend image's
startup command, which applies migrations once before launching the two Uvicorn
workers. Workers do not run migrations. A failed migration prevents server startup.

Numbered SQL files live in `app/sql/migrations/`. The runner records each file's
SHA-256 checksum in `schema_migrations`, verifies installed history, and applies all
pending files in one transaction under a PostgreSQL advisory lock. Repeated runs
are safe; changed or missing installed files cause failure. Add a new migration
instead of editing an applied file. The initial schema is defined in
[`001_create_options.sql`](app/sql/migrations/001_create_options.sql).

For PostgreSQL integration tests:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres uv run pytest -m integration
```

The test account needs permission to create databases. Each test creates and drops
its own uniquely named database; it does not migrate or clear the database named in
the URL. Integration tests skip when `TEST_DATABASE_URL` is absent and fail when a
configured server cannot be reached. CI supplies a PostgreSQL 16 service and runs
these tests with the complete backend suite.

## Implementation

- `app/server.py` — FastAPI app, CORS, lifespan; creates + opens the DB connection pool.
- `app/db.py` — async psycopg pool and scoped connections, using raw SQL without an ORM.
- `app/migrations.py` and `app/sql/migrations/` — explicit locked, checksummed migrations.
- `app/persistence/options.py` — insert-only snapshots, ID lookup, and summary queries.
- `app/application/options.py` and `app/v1/routes/options.py` — root saves and typed
  save/retrieve/list endpoints with version metadata and structured not-found errors.
- `app/v1/routes/health.py` — `GET /api/v1/health`.
- `app/v1/schemas/massing.py` and `app/v1/routes/massing.py` — typed
  `POST /api/v1/massing/preview` contracts, OpenAPI example, and structured 422 errors.
- `app/application/massing.py` — parses site input, invokes the existing massing
  service, and explicitly maps geometry, metrics, preferences, targets, and diagnostics
  to JSON-compatible values without HTTP or database dependencies.
- `app/geometry/site.py` — pure Polygon validation, canonical serialization, and site
  area measurement with Shapely. No HTTP or database dependency.
- `app/geometry/setbacks.py` — mitred inward setbacks, full buildable-region metrics,
  deterministic component selection, and empty/split diagnostics. Empty regions
  serialize as null; selected geometry remains separate from the complete region.
- `app/geometry/footprints.py` — immutable `FootprintLimits`, hard-area upper-bound
  calculation, and `generate_footprint` returning `FootprintResult`. The domain uses
  `max_footprint_area_m2`; HTTP uses `max_footprint_m2` with explicit transport mapping.
  Construction reports success, empty
  buildable regions, or generation failure without claiming full feasibility.
- `app/massing/floors.py` — immutable `FloorLimits`, `InvalidFloorLimits`, and
  `calculate_maximum_permitted_floor_count`. It validates positive finite heights,
  positive integer floor counts, and the requirement for at least one height/count
  limit. The result is a non-negative hard capacity bound.
- `app/massing/defaults.py` — `generate_default_massing`, immutable
  `DefaultMassingResult`, and `NumericalRangeError`. It combines the validated
  geometry and floor operations into one default building with compact repeated-floor
  metrics. Empty buildable regions and zero permitted floors are `infeasible`; a
  failed positive-footprint construction is `generation_failed` and does not claim
  mathematical infeasibility. Hard GFA bounds and generated capacity remain distinct.
- `app/massing/metrics.py` — shared exact stored-float-by-integer metric multiplication
  and `NumericalRangeError`, reused by default and preference-aware massing.
- `app/massing/configurable.py` — `generate_massing_with_preferences` and immutable
  `PreferenceMassingResult`. It composes default context with exact floor preferences,
  optional validated GFA targets, measured preferred footprint geometry, target-driven
  floor selection, and target assessment. Empty/zero-capacity precedence and preferred
  generation failure remain explicit; clamped or approximated area choices can still
  produce a feasible building.
- `app/massing/target_floors.py` and `app/massing/targets.py` — minimum sufficient
  floor-count selection, shared target-fulfillment predicate, validated GFA targets,
  conservative tolerance, and upper-bound/generated-capacity diagnostics.
- `app/massing/preferences.py` and `app/massing/area_preferences.py` — validated
  preference values, exact floor selection, deterministic preferred-area construction,
  and its request/effective/actual diagnostics. Per-floor or 3D representations
  remain planned.
- `app/geometry/tolerances.py` — scale-aware area comparison tolerance, without
  rounding geometry or filtering small positive components.

## Massing preview

With the backend running:

```bash
curl -sS http://localhost:8000/api/v1/massing/preview \
  -H 'Content-Type: application/json' \
  -d '{
    "site": {"type": "Polygon", "coordinates": [[[0,0],[40,0],[40,25],[0,25],[0,0]]]},
    "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_height_m": 24, "max_floors": 6},
    "targets": {"gfa_target_m2": 2000}
  }'
```

The result has a 646 m² footprint, four floors, 14 m height, and 2584 m² GFA.
Open [interactive API documentation](http://localhost:8000/docs) for the typed
contracts and a runnable example. See [the API contract](../docs/DESIGN.md#api-contract)
for validation, feasibility, null geometry, preference, target, and precision semantics.
Previews are transient and never query or write the database. The existing server
lifespan still opens its configured connection pool.

## Root options

Send the same configuration to `POST /api/v1/options`, optionally adding `name`.
The backend recomputes the result, inserts a new root snapshot, and returns `201`
with its UUID and a `Location` header. All feasibility statuses can be saved.
Client-submitted results, metrics, and parent identifiers are rejected.

```bash
curl -sS http://localhost:8000/api/v1/options \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Rectangle study",
    "site": {"type": "Polygon", "coordinates": [[[0,0],[40,0],[40,25],[0,25],[0,0]]]},
    "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_floors": 6},
    "targets": {"gfa_target_m2": 2000}
  }'
curl -sS 'http://localhost:8000/api/v1/options?limit=50&offset=0'
curl -sS http://localhost:8000/api/v1/options/OPTION_UUID
```

Retrieval returns the stored configuration/result and versions without recomputation.
Listing returns metadata and metrics. An unknown UUID returns `404 OPTION_NOT_FOUND`.
The [public API contract](../docs/DESIGN.md#api-contract) defines the complete snapshot,
name validation, pagination, and numerical behavior. There are no update/delete,
branching, tree, comparison, or automatic-alternative endpoints.

Compose retains snapshots in its `db-data` volume across `docker compose restart db backend`
and `docker compose down` followed by `up`. `docker compose down -v` removes that
project's stored data. Back up persistent data before any deliberate volume removal.

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
