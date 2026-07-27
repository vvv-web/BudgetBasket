"""zero amounts for deleted request lines

Revision ID: 20260720_0011
Revises: 20260720_0010
Create Date: 2026-07-20
"""

from alembic import op


revision = "20260720_0011"
down_revision = "20260720_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE req_items SET sum_plan = 0, sum_fact = 0 WHERE status = 'deleted'")


def downgrade() -> None:
    # Previous amounts cannot be reconstructed after normalization.
    pass
