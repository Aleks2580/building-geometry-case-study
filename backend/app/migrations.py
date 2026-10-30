"""Explicit, transactional SQL migrations independent of application workers."""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import LiteralString, cast

from psycopg import AsyncConnection

MIGRATIONS_DIRECTORY = Path(__file__).parent / "sql" / "migrations"
_MIGRATION_FILENAME = re.compile(r"([0-9]{3})_[a-z0-9_]+\.sql")
_MIGRATION_LOCK_ID = 638523933197110309


class MigrationError(RuntimeError):
    """Migration files and the installed history do not agree."""


@dataclass(frozen=True, slots=True)
class Migration:
    version: str
    checksum: str
    sql: LiteralString


def load_migrations(directory: Path = MIGRATIONS_DIRECTORY) -> tuple[Migration, ...]:
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise MigrationError("No SQL migrations were found.")
    numbers: set[str] = set()
    migrations: list[Migration] = []
    for path in files:
        match = _MIGRATION_FILENAME.fullmatch(path.name)
        if match is None or match[1] in numbers:
            raise MigrationError(f"Invalid or duplicate migration number: {path.name}.")
        numbers.add(match[1])
        source = path.read_bytes()
        try:
            sql = source.decode("utf-8")
        except UnicodeDecodeError as error:
            raise MigrationError(f"Migration must use UTF-8: {path.name}.") from error
        if not sql.strip():
            raise MigrationError(f"Migration must not be empty: {path.name}.")
        # Migration files are trusted application SQL, never request data. Keep
        # this trust boundary explicit for psycopg's LiteralString query contract.
        migrations.append(Migration(path.stem, hashlib.sha256(source).hexdigest(), cast(LiteralString, sql)))
    return tuple(migrations)


async def run_migrations(database_url: str, *, migrations_dir: Path | None = None) -> tuple[str, ...]:
    migrations = load_migrations(migrations_dir if migrations_dir is not None else MIGRATIONS_DIRECTORY)
    async with await AsyncConnection.connect(database_url, autocommit=True) as connection:
        async with connection.transaction():
            # Lock before creating the ledger: fresh installations can race too.
            # Keep history validation and every pending migration in this transaction.
            await connection.execute("SELECT pg_advisory_xact_lock(%s)", (_MIGRATION_LOCK_ID,))
            await connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version text PRIMARY KEY,
                    checksum text NOT NULL,
                    applied_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cursor = await connection.execute("SELECT version, checksum FROM schema_migrations ORDER BY version")
            installed = await cursor.fetchall()
            available = {migration.version: migration for migration in migrations}
            for version, checksum in installed:
                if version not in available:
                    raise MigrationError(f"Installed migration is missing from this release: {version}.")
                if checksum != available[version].checksum:
                    raise MigrationError(f"Checksum mismatch for installed migration: {version}.")
            if [version for version, _ in installed] != [
                migration.version for migration in migrations[: len(installed)]
            ]:
                raise MigrationError("Installed migrations must be a contiguous prefix of this release's history.")

            pending = migrations[len(installed) :]
            for migration in pending:
                await connection.execute(migration.sql)
                await connection.execute(
                    "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
                    (migration.version, migration.checksum),
                )
    return tuple(migration.version for migration in pending)
