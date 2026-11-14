"""Shared in-memory fakes for the IBKR MCP tests (no network, no real DB).

Covers exactly the SQLAlchemy calls services/ibkr_mcp.py makes:
  * select(IbkrMcpToken).where(id == ...)   -> singleton token row
  * select(IbkrMcpAuthState) [.(where(state == ...))] -> pending PKCE states
  * select(DeviceSnapshotCache).where(dataset == ...) -> one snapshot row
  * add/commit/delete against those three models
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import Select

from app.models.ibkr import IbkrMcpAuthState, IbkrMcpToken
from app.models.tasks import DeviceSnapshotCache


def run(coro):
    return asyncio.run(coro)


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return list(self._rows)


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _ScalarResult(self._rows)


class FakeDb:
    """Minimal in-memory stand-in for sqlalchemy.ext.asyncio.AsyncSession."""

    def __init__(self):
        self.token_row: IbkrMcpToken | None = None
        self.states: dict[str, IbkrMcpAuthState] = {}
        self.snapshot: DeviceSnapshotCache | None = None
        self.commits = 0
        self._pending = []

    # -- unit of work ---------------------------------------------------------
    def add(self, obj):
        self._pending.append(obj)

    def _flush(self):
        for obj in self._pending:
            if isinstance(obj, IbkrMcpToken):
                self.token_row = obj
            elif isinstance(obj, IbkrMcpAuthState):
                self.states[obj.state] = obj
            elif isinstance(obj, DeviceSnapshotCache):
                self.snapshot = obj
        self._pending.clear()

    async def commit(self):
        self._flush()
        self.commits += 1

    async def delete(self, obj):
        if isinstance(obj, IbkrMcpAuthState):
            self.states.pop(obj.state, None)
        elif obj is self.token_row:
            self.token_row = None
        elif obj is self.snapshot:
            self.snapshot = None

    # -- queries --------------------------------------------------------------
    async def execute(self, stmt):
        if not isinstance(stmt, Select):
            raise TypeError(f"fake session only supports Select, got {stmt!r}")
        entity = stmt.column_descriptions[0]["entity"]
        where = stmt.whereclause
        if entity is IbkrMcpToken:
            rows = [self.token_row] if self.token_row is not None else []
        elif entity is IbkrMcpAuthState:
            if where is None:
                rows = list(self.states.values())
            else:
                wanted = getattr(where.right, "value", None)
                row = self.states.get(wanted)
                rows = [row] if row is not None else []
        elif entity is DeviceSnapshotCache:
            rows = [self.snapshot] if self.snapshot is not None else []
        else:
            raise TypeError(f"unexpected entity in fake session: {entity!r}")
        return _Result(rows)

    # -- async context manager (run_once/refresh open AsyncSessionLocal()) ----
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def seed_tokens(
    db: FakeDb,
    *,
    access: str = "AT1",
    refresh: str = "RT1",
    expires_in: float = 2000,
    last_refresh_at: datetime | None = None,
) -> IbkrMcpToken:
    db.token_row = IbkrMcpToken(
        id="singleton",
        access_token=access,
        refresh_token=refresh,
        expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
        scope="openid profile email",
        token_type="Bearer",
        last_refresh_at=last_refresh_at,
    )
    return db.token_row
