import os
from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
from psycopg import AsyncConnection, sql
from psycopg.conninfo import make_conninfo
from shapely.geometry import Polygon, box

from app.migrations import run_migrations


@pytest.fixture
def cross_lobed_site() -> Polygon:
    site = box(0, 0, 10, 10).union(box(30, 0, 40, 10)).union(box(0, 30, 10, 40)).union(box(30, 30, 40, 40))
    site = site.union(Polygon([(7, 8), (8, 7), (33, 32), (32, 33)]))
    site = site.union(Polygon([(7, 32), (32, 7), (33, 8), (8, 33)]))
    assert isinstance(site, Polygon) and site.is_valid
    return site


@pytest.fixture
async def postgres_database() -> AsyncGenerator[str, None]:
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("Set TEST_DATABASE_URL to run isolated PostgreSQL integration tests.")
    database_name = f"test_massing_{uuid4().hex}"
    async with await AsyncConnection.connect(admin_url, autocommit=True) as admin:
        await admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
        try:
            yield make_conninfo(admin_url, dbname=database_name)
        finally:
            # Only the generated database belongs to this test. FORCE also removes
            # leaked test connections so cleanup cannot silently retain snapshots.
            await admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name)))


@pytest.fixture
async def migrated_database(postgres_database: str) -> str:
    await run_migrations(postgres_database)
    return postgres_database
