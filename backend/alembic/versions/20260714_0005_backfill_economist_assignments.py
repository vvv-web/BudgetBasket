"""backfill unique economist assignments from existing requests

Revision ID: 20260714_0005
Revises: 20260710_0004
Create Date: 2026-07-14
"""

from alembic import op


revision = "20260714_0005"
down_revision = "20260710_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH ranked_active_assignments AS (
            SELECT
                current_assignment.unit_id,
                current_assignment.user_id,
                ROW_NUMBER() OVER (
                    PARTITION BY current_assignment.unit_id
                    ORDER BY COUNT(linked_request.id) DESC, current_assignment.user_id
                ) AS assignment_rank
            FROM units_responsibles AS current_assignment
            JOIN users AS assigned_user ON assigned_user.id = current_assignment.user_id
            LEFT JOIN requests AS linked_request
                ON linked_request.unit_id = current_assignment.unit_id
               AND linked_request.economist_id = current_assignment.user_id
            WHERE current_assignment.is_active = TRUE
              AND assigned_user.role = 'economist'
            GROUP BY current_assignment.unit_id, current_assignment.user_id
        )
        UPDATE units_responsibles AS duplicate_assignment
        SET is_active = FALSE
        FROM ranked_active_assignments AS ranked
        WHERE duplicate_assignment.unit_id = ranked.unit_id
          AND duplicate_assignment.user_id = ranked.user_id
          AND ranked.assignment_rank > 1
        """
    )
    op.execute(
        """
        WITH ranked_request_economists AS (
            SELECT
                unit_id,
                economist_id,
                ROW_NUMBER() OVER (
                    PARTITION BY unit_id
                    ORDER BY COUNT(*) DESC, economist_id
                ) AS assignment_rank
            FROM requests
            WHERE economist_id IS NOT NULL
            GROUP BY unit_id, economist_id
        )
        INSERT INTO units_responsibles (unit_id, user_id, is_active)
        SELECT assignment.unit_id, assignment.economist_id, TRUE
        FROM ranked_request_economists AS assignment
        JOIN users AS target ON target.id = assignment.economist_id
        WHERE target.role = 'economist'
          AND assignment.assignment_rank = 1
          AND NOT EXISTS (
              SELECT 1
              FROM units_responsibles AS current_assignment
              JOIN users AS assigned_user ON assigned_user.id = current_assignment.user_id
              WHERE current_assignment.unit_id = assignment.unit_id
                AND current_assignment.is_active = TRUE
                AND assigned_user.role = 'economist'
          )
        ON CONFLICT (unit_id, user_id)
        DO UPDATE SET is_active = TRUE
        """
    )


def downgrade() -> None:
    # Назначения могли быть изменены администратором после upgrade; безопасно
    # отличить их от восстановленных записей уже невозможно.
    pass
