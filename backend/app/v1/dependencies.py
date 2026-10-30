from collections.abc import AsyncGenerator
from typing import cast

from fastapi import Request
from psycopg_pool import AsyncConnectionPool

from app.persistence.options import OptionRepository


async def get_option_repository(request: Request) -> AsyncGenerator[OptionRepository, None]:
    pool = cast(AsyncConnectionPool, request.app.state.db_pool)
    async with pool.connection() as connection:
        yield OptionRepository(connection)
