"""Async PostgreSQL pool and scoped connections for raw SQL repositories."""

from collections.abc import AsyncGenerator

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.config import Config


def create_pool(config: Config) -> AsyncConnectionPool:
    # open=False: the pool is opened in the app lifespan, not at import time.
    return AsyncConnectionPool(config.database_url, open=False)


async def get_connection(pool: AsyncConnectionPool) -> AsyncGenerator[AsyncConnection, None]:
    async with pool.connection() as conn:
        yield conn
