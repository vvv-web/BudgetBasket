"""reset approval statuses without deleting request content

Revision ID: 20260723_0016
Revises: 20260723_0015
Create Date: 2026-07-23
"""

from alembic import op


revision = "20260723_0016"
down_revision = "20260723_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Correct the original reset rollout for databases that had already
    # received revision 0015: preserve requests, lines, chats and files.
    op.execute("DELETE FROM req_logs")
    op.execute("DELETE FROM step_logs")
    op.execute("DELETE FROM request_step_states")
    op.execute("UPDATE steps SET status = 'waiting'")
    op.execute("UPDATE requests SET status = 'draft', sum_fact = 0, frozen = false, fixed = false")
    op.execute("UPDATE req_items SET status = 'on_review', sum_fact = 0, comment = '' WHERE status <> 'deleted'")
    op.execute("UPDATE units SET annual_budget = 0")


def downgrade() -> None:
    # Approval history is intentionally reset and cannot be reconstructed.
    pass
