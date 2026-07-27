"""rebuild annual budgets from historical closed requests

Revision ID: data_20260720_0001
Revises:
Create Date: 2026-07-20
"""

from alembic import op


revision = "data_20260720_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH RECURSIVE unit_ancestors AS (
            SELECT id AS descendant_id, id AS ancestor_id FROM units
            UNION ALL
            SELECT unit_ancestors.descendant_id, parent.id
            FROM unit_ancestors
            JOIN units current_unit ON current_unit.id = unit_ancestors.ancestor_id
            JOIN units parent ON parent.id = current_unit.parent_id
        ), totals AS (
            SELECT unit_ancestors.ancestor_id, SUM(req_items.sum_fact) AS annual_budget
            FROM unit_ancestors
            JOIN requests ON requests.unit_id = unit_ancestors.descendant_id
            JOIN req_items ON req_items.request_id = requests.id
            WHERE requests.status IN ('approved', 'approved_with_changes', 'partially_approved')
              AND req_items.status IN ('approved', 'approved_with_changes')
            GROUP BY unit_ancestors.ancestor_id
        )
        UPDATE units
        SET annual_budget = COALESCE((
            SELECT totals.annual_budget FROM totals WHERE totals.ancestor_id = units.id
        ), 0)
        """
    )


def downgrade() -> None:
    pass
