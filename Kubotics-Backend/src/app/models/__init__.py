"""Kubotics SQLAlchemy models package.

Importing any submodule of ``app.models`` runs this module first, which
registers ``app.models.needle`` on ``Base.metadata`` alongside the entities
models so ``Base.metadata.create_all`` (local DEBUG lifespan in app.main)
always creates ``needle_inbox`` too.
"""
from app.models.needle import NeedleInbox

__all__ = ["NeedleInbox"]
