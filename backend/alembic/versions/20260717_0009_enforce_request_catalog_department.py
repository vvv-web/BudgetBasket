"""enforce request catalog department

Revision ID: 20260717_0009
Revises: 20260717_0008
Create Date: 2026-07-17
"""

from alembic import op


revision = "20260717_0009"
down_revision = "20260717_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Old data may point to an NSI entry from another department. Keep it as deleted history.
    op.execute(
        """
        UPDATE req_items ri
        SET status = 'deleted', sum_fact = 0,
            comment = CASE
                WHEN comment = '' THEN 'Archived during v1-17 migration: catalog entry belongs to another department.'
                ELSE comment || E'\nArchived during v1-17 migration: catalog entry belongs to another department.'
            END
        FROM requests r
        JOIN units u ON u.id = r.unit_id
        WHERE ri.request_id = r.id
          AND ri.status <> 'deleted'
          AND COALESCE(
                (SELECT d.unit_id FROM dds_catalog d WHERE d.id = ri.dds_id),
                (SELECT i.unit_id FROM invests_catalog i WHERE i.id = ri.invest_id)
              ) IS DISTINCT FROM COALESCE(u.parent_id, u.id)
        """
    )
    op.execute(
        """
        UPDATE requests r
        SET sum_plan = COALESCE((
                SELECT SUM(ri.sum_plan) FROM req_items ri
                WHERE ri.request_id = r.id AND ri.status <> 'deleted'
            ), 0),
            sum_fact = COALESCE((
                SELECT SUM(ri.sum_fact) FROM req_items ri
                WHERE ri.request_id = r.id
                  AND ri.status IN ('approved', 'approved_with_changes')
            ), 0)
        """
    )
    op.execute(
        """
        CREATE FUNCTION validate_req_item_catalog_department() RETURNS trigger AS $$
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
    op.execute(
        "CREATE TRIGGER trg_req_items_catalog_department "
        "BEFORE INSERT OR UPDATE OF request_id, dds_id, invest_id, status ON req_items "
        "FOR EACH ROW EXECUTE FUNCTION validate_req_item_catalog_department()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER trg_req_items_catalog_department ON req_items")
    op.execute("DROP FUNCTION validate_req_item_catalog_department()")
