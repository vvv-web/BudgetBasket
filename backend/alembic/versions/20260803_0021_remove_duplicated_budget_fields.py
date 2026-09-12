"""remove duplicated budget fields from requests and CFO positions

Revision ID: 20260803_0021
Revises: 20260731_0020
Create Date: 2026-08-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260803_0021"
down_revision = "20260731_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Income is a property of request lines, not of their aggregated CFO
    # position. Existing income/expense duplicates are consolidated before the
    # narrower unique indexes are created.
    op.drop_index("ux_cfo_positions_dds", table_name="cfo_positions")
    op.drop_index("ux_cfo_positions_invest", table_name="cfo_positions")
    op.execute(
        """
        CREATE TEMP TABLE cfo_position_merge ON COMMIT DROP AS
        SELECT
            id AS source_id,
            first_value(id) OVER (
                PARTITION BY budget_year, cfo_unit_id, dds_id, invest_id
                ORDER BY id
            ) AS target_id
        FROM cfo_positions;

        UPDATE req_items item
        SET cfo_position_id = map.target_id
        FROM cfo_position_merge map
        WHERE item.cfo_position_id = map.source_id
          AND map.source_id <> map.target_id;

        UPDATE cfo_position_logs log
        SET cfo_position_id = map.target_id
        FROM cfo_position_merge map
        WHERE log.cfo_position_id = map.source_id
          AND map.source_id <> map.target_id;

        WITH merged AS (
            SELECT
                map.target_id,
                bool_or(position.frozen) AS frozen,
                bool_or(position.fixed) AS fixed,
                max(position.updated_at) AS updated_at,
                (
                    array_agg(
                        position.current_step_id
                        ORDER BY position.updated_at DESC NULLS LAST, position.id
                    ) FILTER (WHERE position.current_step_id IS NOT NULL)
                )[1] AS current_step_id,
                CASE
                    WHEN bool_or(position.fixed) THEN 'approved'
                    WHEN bool_or(position.status = 'on_revision') THEN 'on_revision'
                    WHEN bool_or(position.status = 'on_approval') THEN 'on_approval'
                    WHEN bool_or(position.status = 'approved') THEN 'approved'
                    WHEN bool_or(position.status = 'on_review') THEN 'on_review'
                    ELSE 'waiting'
                END AS status
            FROM cfo_positions position
            JOIN cfo_position_merge map ON map.source_id = position.id
            GROUP BY map.target_id
        )
        UPDATE cfo_positions position
        SET frozen = merged.frozen,
            fixed = merged.fixed,
            status = merged.status,
            current_step_id = COALESCE(merged.current_step_id, position.current_step_id),
            updated_at = merged.updated_at
        FROM merged
        WHERE position.id = merged.target_id;

        DELETE FROM cfo_positions position
        USING cfo_position_merge map
        WHERE position.id = map.source_id
          AND map.source_id <> map.target_id;
        """
    )

    op.drop_index("idx_requests_created_by_id", table_name="requests")
    op.drop_constraint("requests_created_by_id_fkey", "requests", type_="foreignkey")
    op.drop_constraint("requests_sum_plan_chk", "requests", type_="check")
    op.drop_constraint("requests_sum_fact_chk", "requests", type_="check")
    op.drop_column("requests", "created_by_id")
    op.drop_column("requests", "sum_plan")
    op.drop_column("requests", "sum_fact")

    op.drop_column("cfo_positions", "is_income")
    op.create_index(
        "ux_cfo_positions_dds",
        "cfo_positions",
        ["budget_year", "cfo_unit_id", "dds_id"],
        unique=True,
        postgresql_where=sa.text("dds_id IS NOT NULL"),
    )
    op.create_index(
        "ux_cfo_positions_invest",
        "cfo_positions",
        ["budget_year", "cfo_unit_id", "invest_id"],
        unique=True,
        postgresql_where=sa.text("invest_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_cfo_positions_invest", table_name="cfo_positions")
    op.drop_index("ux_cfo_positions_dds", table_name="cfo_positions")
    op.add_column(
        "cfo_positions",
        sa.Column("is_income", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index(
        "ux_cfo_positions_dds",
        "cfo_positions",
        ["budget_year", "cfo_unit_id", "is_income", "dds_id"],
        unique=True,
        postgresql_where=sa.text("dds_id IS NOT NULL"),
    )
    op.create_index(
        "ux_cfo_positions_invest",
        "cfo_positions",
        ["budget_year", "cfo_unit_id", "is_income", "invest_id"],
        unique=True,
        postgresql_where=sa.text("invest_id IS NOT NULL"),
    )

    op.add_column("requests", sa.Column("created_by_id", postgresql.UUID(as_uuid=True)))
    op.add_column(
        "requests",
        sa.Column("sum_plan", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "requests",
        sa.Column("sum_fact", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
    )
    op.execute(
        """
        UPDATE requests request
        SET created_by_id = (
            SELECT log.user_id
            FROM req_logs log
            WHERE log.req_id = request.id
              AND log.log->>'action' = 'request_created'
            ORDER BY log.created_at, log.id
            LIMIT 1
        )
        """
    )
    op.create_foreign_key(
        "requests_created_by_id_fkey",
        "requests",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("idx_requests_created_by_id", "requests", ["created_by_id"])
    op.create_check_constraint("requests_sum_plan_chk", "requests", "sum_plan >= 0")
    op.create_check_constraint("requests_sum_fact_chk", "requests", "sum_fact >= 0")
