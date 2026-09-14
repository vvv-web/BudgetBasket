"""add analytics text fields to request lines

Revision ID: 20260807_0026
Revises: 20260806_0025
Create Date: 2026-08-07
"""

from alembic import op
import sqlalchemy as sa


revision = "20260807_0026"
down_revision = "20260806_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for index in range(1, 6):
        op.add_column(
            "req_items",
            sa.Column(f"analytics_{index}", sa.Text(), nullable=False, server_default=sa.text("''")),
        )


def downgrade() -> None:
    for index in range(5, 0, -1):
        op.drop_column("req_items", f"analytics_{index}")
