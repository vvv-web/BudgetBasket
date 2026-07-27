"""harden v1-17 data constraints

Revision ID: 20260717_0007
Revises: 20260717_0006
Create Date: 2026-07-17
"""

from alembic import op


revision = "20260717_0007"
down_revision = "20260717_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE req_items DROP CONSTRAINT req_items_article_chk")
    op.execute(
        "ALTER TABLE req_items ADD CONSTRAINT req_items_article_chk "
        "CHECK ((dds_id IS NULL) <> (invest_id IS NULL))"
    )
    op.execute(
        "CREATE UNIQUE INDEX ux_dds_catalog_scope_name "
        "ON dds_catalog (unit_id, parent_id, lower(name)) NULLS NOT DISTINCT"
    )
    op.execute(
        "CREATE UNIQUE INDEX ux_invests_catalog_scope_name "
        "ON invests_catalog (unit_id, parent_id, lower(name)) NULLS NOT DISTINCT"
    )
    op.execute(
        """
        CREATE FUNCTION set_requests_updated_at() RETURNS trigger AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_requests_updated_at BEFORE UPDATE ON requests "
        "FOR EACH ROW EXECUTE FUNCTION set_requests_updated_at()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER trg_requests_updated_at ON requests")
    op.execute("DROP FUNCTION set_requests_updated_at()")
    op.execute("DROP INDEX ux_invests_catalog_scope_name")
    op.execute("DROP INDEX ux_dds_catalog_scope_name")
    op.execute("ALTER TABLE req_items DROP CONSTRAINT req_items_article_chk")
    op.execute(
        "ALTER TABLE req_items ADD CONSTRAINT req_items_article_chk "
        "CHECK (dds_id IS NOT NULL OR invest_id IS NOT NULL)"
    )
