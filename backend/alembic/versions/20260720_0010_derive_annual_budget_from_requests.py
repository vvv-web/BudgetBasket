"""structural migration stream compatibility marker

Revision ID: 20260720_0010
Revises: 20260717_0009
Create Date: 2026-07-20
"""

from alembic import op


revision = "20260720_0010"
down_revision = "20260717_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The annual-budget backfill is a data migration and is executed only by
    # `alembic -c alembic-data.ini upgrade head`. Keep this revision so
    # databases already stamped with the structural stream remain compatible.
    pass


def downgrade() -> None:
    pass
