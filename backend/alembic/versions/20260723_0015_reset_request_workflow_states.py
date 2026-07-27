"""reset approval state and store statuses per request

Revision ID: 20260723_0015
Revises: 20260723_0014
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260723_0015"
down_revision = "20260723_0014"
branch_labels = None
depends_on = None


STEP_STATUSES = "'waiting', 'on_approval', 'on_revision', 'approved', 'closed'"


def upgrade() -> None:
    op.create_table(
        "request_step_states",
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("step_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'waiting'")),
        sa.CheckConstraint(
            f"status IN ({STEP_STATUSES})",
            name="request_step_states_status_chk",
        ),
        sa.ForeignKeyConstraint(["request_id"], ["requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["steps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("request_id", "step_id"),
    )
    op.create_index(
        "idx_request_step_states_step_status",
        "request_step_states",
        ["step_id", "status"],
    )

    # Keep the request and its content. Only the old approval outcome and
    # route history are reset so the request can start the new process anew.
    op.execute("DELETE FROM req_logs")
    op.execute("DELETE FROM step_logs")
    op.execute("DELETE FROM request_step_states")
    op.execute("UPDATE steps SET status = 'waiting'")
    op.execute("UPDATE requests SET status = 'draft', sum_fact = 0, frozen = false, fixed = false")
    op.execute("UPDATE req_items SET status = 'on_review', sum_fact = 0, comment = '' WHERE status <> 'deleted'")
    op.execute("UPDATE units SET annual_budget = 0")


def downgrade() -> None:
    op.drop_index("idx_request_step_states_step_status", table_name="request_step_states")
    op.drop_table("request_step_states")
