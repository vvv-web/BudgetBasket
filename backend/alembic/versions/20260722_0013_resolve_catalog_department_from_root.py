"""resolve request catalog department from root unit

Revision ID: 20260722_0013
Revises: 20260720_0012
Create Date: 2026-07-22
"""

from alembic import op


revision = "20260722_0013"
down_revision = "20260720_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_req_item_catalog_department() RETURNS trigger AS $$
        DECLARE
            request_department_id uuid;
            catalog_department_id uuid;
        BEGIN
            WITH RECURSIVE ancestry AS (
                SELECT u.id, u.parent_id
                FROM requests r JOIN units u ON u.id = r.unit_id
                WHERE r.id = NEW.request_id
                UNION ALL
                SELECT parent.id, parent.parent_id
                FROM units parent JOIN ancestry child ON child.parent_id = parent.id
            )
            SELECT id INTO request_department_id
            FROM ancestry
            WHERE parent_id IS NULL
            LIMIT 1;

            SELECT unit_id INTO catalog_department_id FROM dds_catalog WHERE id = NEW.dds_id;
            IF catalog_department_id IS NULL THEN
                SELECT unit_id INTO catalog_department_id FROM invests_catalog WHERE id = NEW.invest_id;
            END IF;
            IF NEW.status <> 'deleted' AND catalog_department_id IS DISTINCT FROM request_department_id THEN
                RAISE EXCEPTION 'Request line catalog entry belongs to another department';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_req_item_catalog_department() RETURNS trigger AS $$
        DECLARE
            request_department_id uuid;
            catalog_department_id uuid;
        BEGIN
            SELECT COALESCE(u.parent_id, u.id) INTO request_department_id
            FROM requests r JOIN units u ON u.id = r.unit_id
            WHERE r.id = NEW.request_id;
            SELECT unit_id INTO catalog_department_id FROM dds_catalog WHERE id = NEW.dds_id;
            IF catalog_department_id IS NULL THEN
                SELECT unit_id INTO catalog_department_id FROM invests_catalog WHERE id = NEW.invest_id;
            END IF;
            IF NEW.status <> 'deleted' AND catalog_department_id IS DISTINCT FROM request_department_id THEN
                RAISE EXCEPTION 'Request line catalog entry belongs to another department';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
