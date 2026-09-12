"""move approval workflow from module requests to CFO positions

Revision ID: 20260731_0020
Revises: 20260728_0019
Create Date: 2026-07-31
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260731_0020"
down_revision = "20260728_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Resolve discoverable migration conflicts before altering workflow data.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT module.parent_id
                FROM units_responsibles ur
                JOIN users u ON u.id = ur.user_id
                JOIN roles role ON role.id = u.id_role AND role.name = 'economist'
                JOIN units module ON module.id = ur.unit_id
                WHERE ur.is_active
                  AND module.parent_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM units child WHERE child.parent_id = module.id
                  )
                GROUP BY module.parent_id
                HAVING COUNT(DISTINCT ur.user_id) > 1
            ) THEN
                RAISE EXCEPTION
                    'CFO workflow migration stopped: modules of one CFO have different economists';
            END IF;
            IF EXISTS (
                WITH leaf_routes AS (
                    SELECT
                        module.parent_id AS cfo_id,
                        leaf.id,
                        COALESCE(
                            array_agg(edge.parent_step_id::text ORDER BY edge.parent_step_id)
                                FILTER (WHERE edge.parent_step_id IS NOT NULL),
                            ARRAY[]::text[]
                        )::text AS parent_signature
                    FROM steps leaf
                    JOIN units module ON module.id = leaf.unit_id
                    LEFT JOIN step_edges edge ON edge.child_step_id = leaf.id
                    WHERE module.parent_id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM units child WHERE child.parent_id = module.id
                      )
                    GROUP BY module.parent_id, leaf.id
                )
                SELECT cfo_id
                FROM leaf_routes
                GROUP BY cfo_id
                HAVING COUNT(DISTINCT parent_signature) > 1
            ) OR EXISTS (
                SELECT 1
                FROM steps leaf
                JOIN units module ON module.id = leaf.unit_id
                JOIN step_edges edge ON edge.parent_step_id = leaf.id
                WHERE module.parent_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM units child WHERE child.parent_id = module.id
                  )
            ) THEN
                RAISE EXCEPTION
                    'CFO workflow migration stopped: modules of one CFO have incompatible routes';
            END IF;
        END $$;
        """
    )

    op.add_column("requests", sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("requests", sa.Column("budget_year", sa.BigInteger(), nullable=True))
    op.execute("UPDATE requests SET budget_year = EXTRACT(YEAR FROM created_at)::bigint")
    op.execute(
        """
        UPDATE requests r
        SET created_by_id = COALESCE(
            (
                SELECT rl.user_id
                FROM req_logs rl
                WHERE rl.req_id = r.id
                ORDER BY rl.created_at, rl.id
                LIMIT 1
            ),
            (
                SELECT ur.user_id
                FROM units_responsibles ur
                JOIN users u ON u.id = ur.user_id
                JOIN roles role ON role.id = u.id_role AND role.name = 'employee'
                WHERE ur.unit_id = r.unit_id AND ur.is_active
                ORDER BY ur.user_id
                LIMIT 1
            )
        )
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM requests WHERE created_by_id IS NULL) THEN
                RAISE EXCEPTION
                    'CFO workflow migration stopped: request author cannot be determined';
            END IF;
            IF EXISTS (
                SELECT unit_id, budget_year
                FROM requests
                GROUP BY unit_id, budget_year
                HAVING COUNT(*) > 1
            ) THEN
                RAISE EXCEPTION
                    'CFO workflow migration stopped: a module has multiple requests in one budget year';
            END IF;
        END $$;
        """
    )
    op.alter_column("requests", "created_by_id", nullable=False)
    op.alter_column("requests", "budget_year", nullable=False)
    op.create_foreign_key(
        "requests_created_by_id_fkey",
        "requests",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "requests_budget_year_chk",
        "requests",
        "budget_year BETWEEN 2000 AND 2200",
    )
    op.create_index("idx_requests_created_by_id", "requests", ["created_by_id"])
    op.create_index(
        "ux_requests_unit_budget_year",
        "requests",
        ["unit_id", "budget_year"],
        unique=True,
    )

    # Promote the unique module economist to the CFO and retire module-level
    # economist assignments.
    op.execute(
        """
        INSERT INTO units_responsibles (unit_id, user_id, is_active)
        SELECT DISTINCT module.parent_id, ur.user_id, TRUE
        FROM units_responsibles ur
        JOIN users u ON u.id = ur.user_id
        JOIN roles role ON role.id = u.id_role AND role.name = 'economist'
        JOIN units module ON module.id = ur.unit_id
        WHERE ur.is_active
          AND module.parent_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM units child WHERE child.parent_id = module.id
          )
        ON CONFLICT (unit_id, user_id)
        DO UPDATE SET is_active = TRUE
        """
    )
    op.execute(
        """
        UPDATE units_responsibles ur
        SET is_active = FALSE
        FROM users u, roles role, units module
        WHERE u.id = ur.user_id
          AND role.id = u.id_role
          AND role.name = 'economist'
          AND module.id = ur.unit_id
          AND module.parent_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM units child WHERE child.parent_id = module.id
          )
        """
    )

    op.drop_index("ux_steps_unit_not_null", table_name="steps")
    op.alter_column("steps", "user_id", nullable=True)
    # Compatible module leaves of one CFO are one logical route. Preserve all
    # request state and logs while collapsing them to a deterministic leaf.
    op.execute(
        """
        CREATE TEMP TABLE cfo_leaf_map ON COMMIT DROP AS
        SELECT
            leaf.id AS old_step_id,
            module.parent_id AS cfo_id,
            first_value(leaf.id) OVER (
                PARTITION BY module.parent_id ORDER BY leaf.id
            ) AS canonical_step_id
        FROM steps leaf
        JOIN units module ON module.id = leaf.unit_id
        WHERE module.parent_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM units child WHERE child.parent_id = module.id
          );

        CREATE TEMP TABLE cfo_leaf_request_states ON COMMIT DROP AS
        SELECT
            state.request_id,
            map.canonical_step_id AS step_id,
            (array_agg(
                state.status
                ORDER BY CASE state.status
                    WHEN 'on_revision' THEN 0
                    WHEN 'on_approval' THEN 1
                    WHEN 'approved' THEN 2
                    WHEN 'closed' THEN 3
                    ELSE 4
                END
            ))[1] AS status
        FROM request_step_states state
        JOIN cfo_leaf_map map ON map.old_step_id = state.step_id
        GROUP BY state.request_id, map.canonical_step_id;

        DELETE FROM request_step_states
        WHERE step_id IN (SELECT old_step_id FROM cfo_leaf_map);

        INSERT INTO request_step_states (request_id, step_id, status)
        SELECT request_id, step_id, status
        FROM cfo_leaf_request_states;

        UPDATE step_logs log
        SET step_id = map.canonical_step_id
        FROM cfo_leaf_map map
        WHERE log.step_id = map.old_step_id
          AND map.old_step_id <> map.canonical_step_id;

        INSERT INTO step_edges (parent_step_id, child_step_id)
        SELECT DISTINCT edge.parent_step_id, map.canonical_step_id
        FROM step_edges edge
        JOIN cfo_leaf_map map ON map.old_step_id = edge.child_step_id
        ON CONFLICT DO NOTHING;

        DELETE FROM step_edges
        WHERE child_step_id IN (
            SELECT old_step_id
            FROM cfo_leaf_map
            WHERE old_step_id <> canonical_step_id
        );

        DELETE FROM steps
        WHERE id IN (
            SELECT old_step_id
            FROM cfo_leaf_map
            WHERE old_step_id <> canonical_step_id
        );
        """
    )
    op.execute(
        """
        UPDATE steps leaf
        SET unit_id = module.parent_id,
            user_id = NULL
        FROM units module
        WHERE module.id = leaf.unit_id
          AND module.parent_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM units child WHERE child.parent_id = module.id
          )
        """
    )
    op.create_index(
        "ux_steps_unit_not_null",
        "steps",
        ["unit_id"],
        unique=True,
        postgresql_where=sa.text("unit_id IS NOT NULL"),
    )

    op.create_table(
        "cfo_positions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("budget_year", sa.BigInteger(), nullable=False),
        sa.Column("cfo_unit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dds_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("invest_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_income", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'waiting'")),
        sa.Column("current_step_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("fixed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("budget_year BETWEEN 2000 AND 2200", name="cfo_positions_budget_year_chk"),
        sa.CheckConstraint("(dds_id IS NULL) <> (invest_id IS NULL)", name="cfo_positions_article_chk"),
        sa.CheckConstraint(
            "status IN ('waiting', 'on_review', 'on_approval', 'approved', 'on_revision')",
            name="cfo_positions_status_chk",
        ),
        sa.CheckConstraint("NOT fixed OR frozen", name="cfo_positions_fixed_requires_frozen_chk"),
        sa.ForeignKeyConstraint(["cfo_unit_id"], ["units.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["current_step_id"], ["steps.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["dds_id"], ["dds_catalog.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["invest_id"], ["invests_catalog.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_cfo_positions_cfo_year", "cfo_positions", ["cfo_unit_id", "budget_year"])
    op.create_index("idx_cfo_positions_status", "cfo_positions", ["status"])
    op.create_index("idx_cfo_positions_current_step", "cfo_positions", ["current_step_id"])
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
    op.add_column(
        "req_items",
        sa.Column("cfo_position_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "req_items_cfo_position_id_fkey",
        "req_items",
        "cfo_positions",
        ["cfo_position_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("idx_req_items_cfo_position_id", "req_items", ["cfo_position_id"])

    # Preserve finalized legacy budgets as CFO positions. Draft, in-review and
    # cancelled requests intentionally remain without positions.
    op.execute(
        """
        INSERT INTO cfo_positions (
            budget_year, cfo_unit_id, dds_id, invest_id, is_income,
            status, frozen, fixed
        )
        SELECT
            r.budget_year,
            module.parent_id,
            ri.dds_id,
            ri.invest_id,
            ri.is_income,
            CASE WHEN bool_or(r.frozen) THEN 'approved' ELSE 'waiting' END,
            bool_or(r.frozen),
            bool_and(r.fixed)
        FROM req_items ri
        JOIN requests r ON r.id = ri.request_id
        JOIN units module ON module.id = r.unit_id
        WHERE r.status IN ('approved', 'approved_with_changes', 'partially_approved')
          AND ri.status IN ('approved', 'approved_with_changes')
          AND module.parent_id IS NOT NULL
        GROUP BY r.budget_year, module.parent_id, ri.dds_id, ri.invest_id, ri.is_income
        """
    )
    op.execute(
        """
        UPDATE req_items ri
        SET cfo_position_id = cp.id
        FROM requests r
        JOIN units module ON module.id = r.unit_id
        JOIN cfo_positions cp
          ON cp.budget_year = r.budget_year
         AND cp.cfo_unit_id = module.parent_id
        WHERE ri.request_id = r.id
          AND ri.status IN ('approved', 'approved_with_changes')
          AND cp.is_income = ri.is_income
          AND cp.dds_id IS NOT DISTINCT FROM ri.dds_id
          AND cp.invest_id IS NOT DISTINCT FROM ri.invest_id
        """
    )
    op.execute(
        """
        UPDATE cfo_positions cp
        SET current_step_id = candidate.step_id,
            status = CASE
                WHEN candidate.step_status = 'on_revision' THEN 'on_revision'
                WHEN candidate.step_status = 'on_approval' THEN 'on_approval'
                ELSE cp.status
            END
        FROM (
            SELECT DISTINCT ON (ri.cfo_position_id)
                ri.cfo_position_id,
                rss.step_id,
                rss.status AS step_status
            FROM req_items ri
            JOIN request_step_states rss ON rss.request_id = ri.request_id
            WHERE ri.cfo_position_id IS NOT NULL
              AND rss.status IN ('on_approval', 'on_revision')
            ORDER BY ri.cfo_position_id,
                     CASE rss.status WHEN 'on_revision' THEN 0 ELSE 1 END,
                     rss.step_id
        ) candidate
        WHERE cp.id = candidate.cfo_position_id
        """
    )

    op.create_table(
        "cfo_position_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("cfo_position_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("step_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("log", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["cfo_position_id"], ["cfo_positions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["steps.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_cfo_position_logs_position_created",
        "cfo_position_logs",
        ["cfo_position_id", "created_at"],
    )
    op.create_index("idx_cfo_position_logs_step_id", "cfo_position_logs", ["step_id"])
    op.create_index("idx_cfo_position_logs_user_id", "cfo_position_logs", ["user_id"])

    op.create_table(
        "notifications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_notifications_user_created", "notifications", ["user_id", "created_at"])
    op.create_index("idx_notifications_user_read", "notifications", ["user_id", "read_at"])

    op.execute(
        """
        UPDATE requests
        SET status = CASE
            WHEN status IN ('approved', 'approved_with_changes', 'partially_approved') THEN 'approved'
            ELSE status
        END
        """
    )
    op.drop_constraint("requests_status_chk", "requests", type_="check")
    op.create_check_constraint(
        "requests_status_chk",
        "requests",
        "status IN ('draft', 'on_review', 'approved', 'rejected', 'cancelled')",
    )
    op.drop_index("idx_requests_economist_id", table_name="requests")
    op.drop_column("requests", "economist_id")
    op.drop_column("requests", "frozen")
    op.drop_column("requests", "fixed")
    op.drop_index("idx_request_step_states_step_status", table_name="request_step_states")
    op.drop_table("request_step_states")


def downgrade() -> None:
    op.create_table(
        "request_step_states",
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("step_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'waiting'")),
        sa.CheckConstraint(
            "status IN ('waiting', 'on_approval', 'on_revision', 'approved', 'closed')",
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
    op.add_column("requests", sa.Column("economist_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("requests", sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("requests", sa.Column("fixed", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_foreign_key(
        "requests_economist_id_fkey",
        "requests",
        "users",
        ["economist_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_requests_economist_id", "requests", ["economist_id"])
    op.execute(
        """
        UPDATE requests r
        SET economist_id = (
                SELECT ur.user_id
                FROM units module
                JOIN units_responsibles ur
                  ON ur.unit_id = module.parent_id AND ur.is_active
                JOIN users u ON u.id = ur.user_id
                JOIN roles role ON role.id = u.id_role AND role.name = 'economist'
                WHERE module.id = r.unit_id
                ORDER BY ur.user_id
                LIMIT 1
            ),
            frozen = COALESCE((
                SELECT bool_and(cp.frozen)
                FROM req_items ri
                JOIN cfo_positions cp ON cp.id = ri.cfo_position_id
                WHERE ri.request_id = r.id
            ), FALSE),
            fixed = COALESCE((
                SELECT bool_and(cp.fixed)
                FROM req_items ri
                JOIN cfo_positions cp ON cp.id = ri.cfo_position_id
                WHERE ri.request_id = r.id
            ), FALSE)
        """
    )
    op.execute(
        """
        INSERT INTO request_step_states (request_id, step_id, status)
        SELECT DISTINCT
            ri.request_id,
            cp.current_step_id,
            CASE cp.status
                WHEN 'on_revision' THEN 'on_revision'
                WHEN 'on_approval' THEN 'on_approval'
                WHEN 'approved' THEN 'approved'
                ELSE 'waiting'
            END
        FROM req_items ri
        JOIN cfo_positions cp ON cp.id = ri.cfo_position_id
        WHERE cp.current_step_id IS NOT NULL
        ON CONFLICT (request_id, step_id)
        DO UPDATE SET status = EXCLUDED.status
        """
    )
    op.drop_constraint("requests_status_chk", "requests", type_="check")
    op.create_check_constraint(
        "requests_status_chk",
        "requests",
        "status IN ('draft', 'on_review', 'approved', 'approved_with_changes', "
        "'partially_approved', 'rejected', 'cancelled')",
    )

    op.drop_index("idx_notifications_user_read", table_name="notifications")
    op.drop_index("idx_notifications_user_created", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("idx_cfo_position_logs_user_id", table_name="cfo_position_logs")
    op.drop_index("idx_cfo_position_logs_step_id", table_name="cfo_position_logs")
    op.drop_index("idx_cfo_position_logs_position_created", table_name="cfo_position_logs")
    op.drop_table("cfo_position_logs")
    op.drop_index("idx_req_items_cfo_position_id", table_name="req_items")
    op.drop_constraint("req_items_cfo_position_id_fkey", "req_items", type_="foreignkey")
    op.drop_column("req_items", "cfo_position_id")
    op.drop_index("ux_cfo_positions_invest", table_name="cfo_positions")
    op.drop_index("ux_cfo_positions_dds", table_name="cfo_positions")
    op.drop_index("idx_cfo_positions_current_step", table_name="cfo_positions")
    op.drop_index("idx_cfo_positions_status", table_name="cfo_positions")
    op.drop_index("idx_cfo_positions_cfo_year", table_name="cfo_positions")
    op.drop_table("cfo_positions")

    op.drop_index("ux_steps_unit_not_null", table_name="steps")
    op.execute(
        """
        CREATE TEMP TABLE downgrade_leaf_map ON COMMIT DROP AS
        SELECT
            leaf.id AS cfo_step_id,
            leaf.unit_id AS cfo_unit_id,
            module.id AS module_id,
            row_number() OVER (
                PARTITION BY leaf.id ORDER BY module.id
            ) AS module_number,
            CASE
                WHEN row_number() OVER (
                    PARTITION BY leaf.id ORDER BY module.id
                ) = 1 THEN leaf.id
                ELSE gen_random_uuid()
            END AS target_step_id,
            leaf.status,
            (
                SELECT ur.user_id
                FROM units_responsibles ur
                JOIN users u ON u.id = ur.user_id
                JOIN roles role ON role.id = u.id_role AND role.name = 'economist'
                WHERE ur.unit_id = leaf.unit_id AND ur.is_active
                ORDER BY ur.user_id
                LIMIT 1
            ) AS economist_id
        FROM steps leaf
        JOIN units module ON module.parent_id = leaf.unit_id
        WHERE leaf.unit_id IS NOT NULL;

        INSERT INTO steps (id, user_id, unit_id, status)
        SELECT target_step_id, economist_id, module_id, status
        FROM downgrade_leaf_map
        WHERE module_number > 1;

        INSERT INTO step_edges (parent_step_id, child_step_id)
        SELECT edge.parent_step_id, map.target_step_id
        FROM downgrade_leaf_map map
        JOIN step_edges edge ON edge.child_step_id = map.cfo_step_id
        WHERE map.module_number > 1
        ON CONFLICT DO NOTHING;

        UPDATE steps leaf
        SET unit_id = map.module_id,
            user_id = map.economist_id
        FROM downgrade_leaf_map map
        WHERE leaf.id = map.cfo_step_id
          AND map.module_number = 1;

        INSERT INTO request_step_states (request_id, step_id, status)
        SELECT state.request_id, map.target_step_id, state.status
        FROM request_step_states state
        JOIN requests request ON request.id = state.request_id
        JOIN downgrade_leaf_map map
          ON map.cfo_step_id = state.step_id
         AND map.module_id = request.unit_id
         AND map.module_number > 1
        ON CONFLICT (request_id, step_id)
        DO UPDATE SET status = EXCLUDED.status;

        DELETE FROM request_step_states state
        USING requests request, downgrade_leaf_map map
        WHERE request.id = state.request_id
          AND map.cfo_step_id = state.step_id
          AND map.module_id = request.unit_id
          AND map.module_number > 1;

        INSERT INTO units_responsibles (unit_id, user_id, is_active)
        SELECT DISTINCT map.module_id, map.economist_id, TRUE
        FROM downgrade_leaf_map map
        WHERE map.economist_id IS NOT NULL
        ON CONFLICT (unit_id, user_id)
        DO UPDATE SET is_active = TRUE;

        UPDATE units_responsibles assignment
        SET is_active = FALSE
        FROM users account, roles role
        WHERE account.id = assignment.user_id
          AND role.id = account.id_role
          AND role.name = 'economist'
          AND assignment.unit_id IN (
              SELECT DISTINCT cfo_unit_id FROM downgrade_leaf_map
          );
        """
    )
    op.alter_column("steps", "user_id", nullable=False)
    op.create_index(
        "ux_steps_unit_not_null",
        "steps",
        ["unit_id"],
        unique=True,
        postgresql_where=sa.text("unit_id IS NOT NULL"),
    )

    op.drop_index("ux_requests_unit_budget_year", table_name="requests")
    op.drop_index("idx_requests_created_by_id", table_name="requests")
    op.drop_constraint("requests_budget_year_chk", "requests", type_="check")
    op.drop_constraint("requests_created_by_id_fkey", "requests", type_="foreignkey")
    op.drop_column("requests", "budget_year")
    op.drop_column("requests", "created_by_id")
