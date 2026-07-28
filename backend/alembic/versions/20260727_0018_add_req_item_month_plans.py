"""add monthly plans for income request lines

Revision ID: 20260727_0018
Revises: 20260724_0017
Create Date: 2026-07-27
"""

from alembic import op
import sqlalchemy as sa


revision = "20260727_0018"
down_revision = "20260724_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "req_item_month_plans",
        sa.Column("req_item_id", sa.UUID(), sa.ForeignKey("req_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("month", sa.SmallInteger(), nullable=False),
        sa.Column("sum_plan", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("req_item_id", "month"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="req_item_month_plans_month_chk"),
        sa.CheckConstraint("sum_plan >= 0", name="req_item_month_plans_sum_plan_chk"),
    )


def downgrade() -> None:
    op.drop_table("req_item_month_plans")
