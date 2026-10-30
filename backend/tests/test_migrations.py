import asyncio
import hashlib
from pathlib import Path

import pytest
from psycopg import AsyncConnection
from psycopg.errors import UndefinedTable
from typer.testing import CliRunner

from app.cli import cli
from app.migrations import MIGRATIONS_DIRECTORY, MigrationError, load_migrations, run_migrations


def test_migration_checksum_uses_exact_source_bytes(tmp_path: Path) -> None:
    source = b"CREATE TABLE example (id integer);\n"
    (tmp_path / "001_example.sql").write_bytes(source)

    migrations = load_migrations(tmp_path)

    assert len(migrations) == 1
    assert migrations[0].version == "001_example"
    assert migrations[0].checksum == hashlib.sha256(source).hexdigest()
    assert migrations[0].sql == source.decode()


@pytest.mark.parametrize("filenames", [[], ["create_options.sql"], ["001_first.sql", "001_duplicate.sql"]])
def test_missing_malformed_and_duplicate_numbers_are_rejected(tmp_path: Path, filenames: list[str]) -> None:
    for filename in filenames:
        (tmp_path / filename).write_text("SELECT 1;")
    with pytest.raises(MigrationError):
        load_migrations(tmp_path)


def test_migration_cli_reports_applied_and_current_versions(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []

    async def migrate(database_url: str) -> tuple[str, ...]:
        calls.append(database_url)
        return ("001_create_options",) if len(calls) == 1 else ()

    monkeypatch.setattr("app.migrations.run_migrations", migrate)
    monkeypatch.setenv("APP_DATABASE_URL", "postgresql://test@example.test/test")
    runner = CliRunner()

    applied = runner.invoke(cli, ["migrate"])
    current = runner.invoke(cli, ["migrate"])

    assert applied.exit_code == current.exit_code == 0
    assert "001_create_options" in applied.output
    assert "up to date" in current.output
    assert calls == ["postgresql://test@example.test/test"] * 2


def test_migration_cli_fails_without_starting_workers(monkeypatch: pytest.MonkeyPatch) -> None:
    async def migrate(database_url: str) -> tuple[str, ...]:
        raise MigrationError("Checksum mismatch for installed migration: 001_create_options.")

    monkeypatch.setattr("app.migrations.run_migrations", migrate)

    response = CliRunner().invoke(cli, ["migrate"])

    assert response.exit_code == 1
    assert "Checksum mismatch" in response.output


@pytest.mark.integration
async def test_fresh_installation_creates_schema_and_indexes(postgres_database: str) -> None:
    applied = await run_migrations(postgres_database)
    assert applied == ("001_create_options",)
    async with await AsyncConnection.connect(postgres_database) as connection:
        cursor = await connection.execute("SELECT version, checksum, applied_at FROM schema_migrations")
        rows = await cursor.fetchall()
        migration = load_migrations()[0]
        assert len(rows) == 1
        assert rows[0][:2] == (migration.version, migration.checksum)
        assert rows[0][2].tzinfo is not None
        cursor = await connection.execute(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'options'"
        )
        columns = dict(await cursor.fetchall())
        assert columns == {
            "id": "uuid",
            "parent_id": "uuid",
            "name": "text",
            "schema_version": "integer",
            "algorithm_version": "text",
            "site_geometry": "jsonb",
            "hard_constraints": "jsonb",
            "preferences": "jsonb",
            "targets": "jsonb",
            "result": "jsonb",
            "feasibility_status": "text",
            "created_at": "timestamp with time zone",
        }
        cursor = await connection.execute("SELECT indexname FROM pg_indexes WHERE tablename = 'options'")
        assert {row[0] for row in await cursor.fetchall()} == {
            "options_pkey",
            "options_parent_id_idx",
            "options_created_at_idx",
        }


@pytest.mark.integration
async def test_idempotent_rerun_preserves_ledger(migrated_database: str) -> None:
    async with await AsyncConnection.connect(migrated_database) as connection:
        cursor = await connection.execute("SELECT version, checksum, applied_at FROM schema_migrations")
        before = await cursor.fetchall()

    assert await run_migrations(migrated_database) == ()

    async with await AsyncConnection.connect(migrated_database) as connection:
        cursor = await connection.execute("SELECT version, checksum, applied_at FROM schema_migrations")
        assert await cursor.fetchall() == before


@pytest.mark.integration
async def test_checksum_mismatch_rejects_pending_sql(migrated_database: str, tmp_path: Path) -> None:
    migration = MIGRATIONS_DIRECTORY / "001_create_options.sql"
    (tmp_path / migration.name).write_bytes(migration.read_bytes() + b"\n-- changed\n")
    (tmp_path / "002_pending.sql").write_text("CREATE TABLE should_not_exist (id integer);")

    with pytest.raises(MigrationError, match="Checksum mismatch"):
        await run_migrations(migrated_database, migrations_dir=tmp_path)

    async with await AsyncConnection.connect(migrated_database) as connection:
        cursor = await connection.execute("SELECT to_regclass('should_not_exist')")
        assert await cursor.fetchone() == (None,)
        cursor = await connection.execute("SELECT count(*) FROM schema_migrations")
        assert await cursor.fetchone() == (1,)


@pytest.mark.integration
async def test_unknown_installed_version_is_rejected(migrated_database: str) -> None:
    async with await AsyncConnection.connect(migrated_database) as connection:
        await connection.execute("UPDATE schema_migrations SET version = '999_unknown'")
    with pytest.raises(MigrationError, match="missing from this release"):
        await run_migrations(migrated_database)


@pytest.mark.integration
async def test_non_prefix_history_is_rejected(postgres_database: str, tmp_path: Path) -> None:
    (tmp_path / "001_first.sql").write_text("CREATE TABLE first (id integer);")
    (tmp_path / "002_second.sql").write_text("CREATE TABLE second (id integer);")
    await run_migrations(postgres_database, migrations_dir=tmp_path)
    async with await AsyncConnection.connect(postgres_database) as connection:
        await connection.execute("DELETE FROM schema_migrations WHERE version = '001_first'")

    with pytest.raises(MigrationError, match="contiguous prefix"):
        await run_migrations(postgres_database, migrations_dir=tmp_path)


@pytest.mark.integration
async def test_failed_installation_rolls_back_every_pending_migration(postgres_database: str, tmp_path: Path) -> None:
    (tmp_path / "001_first.sql").write_text("CREATE TABLE first (id integer);")
    (tmp_path / "002_broken.sql").write_text("SELECT * FROM nonexistent_table;")

    with pytest.raises(UndefinedTable):
        await run_migrations(postgres_database, migrations_dir=tmp_path)

    async with await AsyncConnection.connect(postgres_database) as connection:
        cursor = await connection.execute("SELECT to_regclass('first'), to_regclass('schema_migrations')")
        assert await cursor.fetchone() == (None, None)


@pytest.mark.integration
async def test_concurrent_migration_runs_serialize_on_fresh_database(postgres_database: str) -> None:
    results = await asyncio.gather(run_migrations(postgres_database), run_migrations(postgres_database))
    assert sorted(results, key=len) == [(), ("001_create_options",)]
