"""allow cancelled requests while keeping one active request per module and year

Revision ID: 20260902_0028
Revises: 20260827_0027
"""

from alembic import op
import sqlalchemy as sa


revision = "20260902_0028"
down_revision = "20260827_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ux_requests_unit_budget_year", table_name="requests")
    op.create_index(
        "ux_requests_active_unit_budget_year",
        "requests",
        ["unit_id", "budget_year"],
        unique=True,
        postgresql_where=sa.text("status <> 'cancelled'"),
    )


def downgrade() -> None:
    op.drop_index("ux_requests_active_unit_budget_year", table_name="requests")
    op.create_index(
        "ux_requests_unit_budget_year",
        "requests",
        ["unit_id", "budget_year"],
        unique=True,
    )
