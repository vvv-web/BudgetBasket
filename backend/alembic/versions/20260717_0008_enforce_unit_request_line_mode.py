"""enforce one request-line mode per unit

Revision ID: 20260717_0008
Revises: 20260717_0007
Create Date: 2026-07-17
"""

from alembic import op


revision = "20260717_0008"
down_revision = "20260717_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preserve legacy mixed lines as deleted history; v1-17 allows one active kind per unit.
    op.execute(
        """
        UPDATE req_items ri
        SET status = 'deleted', sum_fact = 0,
            comment = CASE
                WHEN comment = '' THEN 'Archived during v1-17 migration: line type conflicts with the unit mode.'
                ELSE comment || E'\nArchived during v1-17 migration: line type conflicts with the unit mode.'
            END
        FROM requests r
        JOIN units u ON u.id = r.unit_id
        WHERE ri.request_id = r.id
          AND ri.status <> 'deleted'
          AND ((u.uses_invest_projects AND ri.dds_id IS NOT NULL)
               OR (NOT u.uses_invest_projects AND ri.invest_id IS NOT NULL))
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
        CREATE FUNCTION validate_req_item_catalog_mode() RETURNS trigger AS $$
        DECLARE
            unit_uses_invest_projects boolean;
        BEGIN
            SELECT u.uses_invest_projects INTO unit_uses_invest_projects
            FROM requests r JOIN units u ON u.id = r.unit_id
            WHERE r.id = NEW.request_id;
            IF NEW.status <> 'deleted' AND (
                (unit_uses_invest_projects AND NEW.dds_id IS NOT NULL) OR
                (NOT unit_uses_invest_projects AND NEW.invest_id IS NOT NULL)
            ) THEN
                RAISE EXCEPTION 'Request line type does not match the unit mode';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_req_items_catalog_mode "
        "BEFORE INSERT OR UPDATE OF request_id, dds_id, invest_id, status ON req_items "
        "FOR EACH ROW EXECUTE FUNCTION validate_req_item_catalog_mode()"
    )
    op.execute(
        """
        CREATE FUNCTION validate_unit_catalog_mode() RETURNS trigger AS $$
        BEGIN
            IF NEW.uses_invest_projects IS DISTINCT FROM OLD.uses_invest_projects AND EXISTS (
                SELECT 1
                FROM requests r JOIN req_items ri ON ri.request_id = r.id
                WHERE r.unit_id = NEW.id
                  AND ri.status <> 'deleted'
                  AND ((NEW.uses_invest_projects AND ri.dds_id IS NOT NULL)
                       OR (NOT NEW.uses_invest_projects AND ri.invest_id IS NOT NULL))
            ) THEN
                RAISE EXCEPTION 'Cannot change unit mode while active request lines use the other type';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_units_catalog_mode BEFORE UPDATE OF uses_invest_projects ON units "
        "FOR EACH ROW EXECUTE FUNCTION validate_unit_catalog_mode()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER trg_units_catalog_mode ON units")
    op.execute("DROP FUNCTION validate_unit_catalog_mode()")
    op.execute("DROP TRIGGER trg_req_items_catalog_mode ON req_items")
    op.execute("DROP FUNCTION validate_req_item_catalog_mode()")
