"""normalize roles and add the budget approval graph

Revision ID: 20260723_0014
Revises: 20260722_0013
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260723_0014"
down_revision = "20260722_0013"
branch_labels = None
depends_on = None


STEP_STATUSES = "'waiting', 'on_approval', 'on_revision', 'approved', 'closed'"


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.execute(
        """
        INSERT INTO roles(name)
        VALUES ('admin'), ('employee'), ('economist'), ('approver'), ('zgd')
        """
    )
    op.add_column("users", sa.Column("id_role", sa.BigInteger(), nullable=True))
    op.execute(
        """
        UPDATE users
        SET id_role = roles.id
        FROM roles
        WHERE roles.name = users.role
        """
    )
    op.alter_column("users", "id_role", nullable=False)
    op.create_foreign_key(
        "users_id_role_fkey",
        "users",
        "roles",
        ["id_role"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("idx_users_id_role", "users", ["id_role"])
    op.drop_index("idx_users_role", table_name="users")
    op.drop_constraint("users_role_chk", "users", type_="check")
    op.drop_column("users", "role")

    op.add_column(
        "requests",
        sa.Column("fixed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "steps",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'waiting'")),
        sa.CheckConstraint(f"status IN ({STEP_STATUSES})", name="steps_status_chk"),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_steps_user_status", "steps", ["user_id", "status"])
    op.create_index(
        "ux_steps_unit_not_null",
        "steps",
        ["unit_id"],
        unique=True,
        postgresql_where=sa.text("unit_id IS NOT NULL"),
    )

    op.create_table(
        "step_edges",
        sa.Column("parent_step_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("child_step_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.CheckConstraint("parent_step_id <> child_step_id", name="step_edges_no_self_chk"),
        sa.ForeignKeyConstraint(["child_step_id"], ["steps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_step_id"], ["steps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("parent_step_id", "child_step_id"),
    )
    op.create_index("idx_step_edges_child", "step_edges", ["child_step_id"])

    op.create_table(
        "step_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("step_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("log", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["step_id"], ["steps.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_step_logs_step_created_at",
        "step_logs",
        ["step_id", sa.text("created_at DESC")],
    )
    op.create_index("idx_step_logs_user_id", "step_logs", ["user_id"])
    op.execute("CREATE INDEX idx_step_logs_action ON step_logs ((log->>'action'))")


def downgrade() -> None:
    op.drop_index("idx_step_logs_action", table_name="step_logs")
    op.drop_index("idx_step_logs_user_id", table_name="step_logs")
    op.drop_index("idx_step_logs_step_created_at", table_name="step_logs")
    op.drop_table("step_logs")
    op.drop_index("idx_step_edges_child", table_name="step_edges")
    op.drop_table("step_edges")
    op.drop_index("ux_steps_unit_not_null", table_name="steps")
    op.drop_index("idx_steps_user_status", table_name="steps")
    op.drop_table("steps")

    op.drop_column("requests", "fixed")

    op.add_column("users", sa.Column("role", sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE users
        SET role = roles.name
        FROM roles
        WHERE roles.id = users.id_role
        """
    )
    op.alter_column("users", "role", nullable=False)
    op.create_check_constraint(
        "users_role_chk",
        "users",
        "role IN ('admin', 'economist', 'employee', 'approver', 'zgd')",
    )
    op.create_index("idx_users_role", "users", ["role"])
    op.drop_constraint("users_id_role_fkey", "users", type_="foreignkey")
    op.drop_index("idx_users_id_role", table_name="users")
    op.drop_column("users", "id_role")
    op.drop_table("roles")
