"""add income flag to request items

Revision ID: 20260720_0012
Revises: 20260720_0011
Create Date: 2026-07-20
"""

from alembic import op
import sqlalchemy as sa


revision = "20260720_0012"
down_revision = "20260720_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "req_items",
        sa.Column("is_income", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("idx_req_items_is_income", "req_items", ["is_income"])


def downgrade() -> None:
    op.drop_index("idx_req_items_is_income", table_name="req_items")
    op.drop_column("req_items", "is_income")
