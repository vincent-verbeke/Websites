"""Binance Executor persistence (Vincent GO 2026-11-28).

Two tables only, both created by ``Base.metadata.create_all``:

* ``binance_executor_state`` — key/value JSON state (carry open pairs,
  momentum basket, daily pnl counters, kill-switch). Mirrors the
  ``carry_state.json``/``live_state.json`` semantics of the challenge code.
* ``binance_executor_orders`` — append-only action journal: every decision
  (dry or live) with the exchange response, so the 4-hour follow-ups and any
  audit can replay what the executor did.
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class BinExecState(Base):
    __tablename__ = "binance_executor_state"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class BinExecOrder(Base):
    __tablename__ = "binance_executor_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True,
                                    autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                         default=_utcnow)
    kind: Mapped[str] = mapped_column(String(48))       # CARRY_ENTRY / ...
    symbol: Mapped[str] = mapped_column(String(24), default="")
    side: Mapped[str] = mapped_column(String(8), default="")
    qty: Mapped[float] = mapped_column(Float, default=0.0)
    price: Mapped[float] = mapped_column(Float, default=0.0)
    notional: Mapped[float] = mapped_column(Float, default=0.0)
    mode: Mapped[str] = mapped_column(String(8), default="dry")  # dry|live
    cycle: Mapped[str] = mapped_column(String(24), default="")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    note: Mapped[str] = mapped_column(Text, default="")
