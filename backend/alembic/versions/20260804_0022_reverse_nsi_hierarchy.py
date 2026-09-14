"""make NSI roots articles and children categories

Revision ID: 20260804_0022
Revises: 20260803_0021
Create Date: 2026-08-04
"""

from alembic import op


revision = "20260804_0022"
down_revision = "20260803_0021"
branch_labels = None
depends_on = None


def _reverse_catalog(collection: str, reference_field: str) -> None:
    # Old data was category -> article and request lines referenced the article.
    # Preserve every old article as a new root and give it a child category,
    # then move the stored references to that child category.
    op.execute(
        f"""
        CREATE TEMP TABLE nsi_old_children_{collection} ON COMMIT DROP AS
        SELECT id FROM {collection} WHERE parent_id IS NOT NULL;

        UPDATE {collection}
        SET parent_id = NULL
        WHERE id IN (SELECT id FROM nsi_old_children_{collection});

        DELETE FROM {collection} AS root
        WHERE root.id NOT IN (SELECT id FROM nsi_old_children_{collection})
          AND NOT EXISTS (SELECT 1 FROM req_items item WHERE item.{reference_field} = root.id)
          AND NOT EXISTS (SELECT 1 FROM cfo_positions position WHERE position.{reference_field} = root.id);

        INSERT INTO {collection} (parent_id, unit_id, name, is_active)
        SELECT article.id, article.unit_id, article.name, article.is_active
        FROM {collection} AS article
        WHERE article.parent_id IS NULL;

        UPDATE req_items AS item
        SET {reference_field} = category.id
        FROM {collection} AS category
        WHERE category.parent_id = item.{reference_field};

        UPDATE cfo_positions AS position
        SET {reference_field} = category.id
        FROM {collection} AS category
        WHERE category.parent_id = position.{reference_field};
        """
    )


def upgrade() -> None:
    _reverse_catalog("dds_catalog", "dds_id")
    _reverse_catalog("invests_catalog", "invest_id")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_req_item_catalog_department() RETURNS trigger AS $$
        DECLARE
            request_department_id uuid;
            catalog_department_id uuid;
            catalog_parent_id uuid;
        BEGIN
            WITH RECURSIVE ancestry AS (
                SELECT u.id, u.parent_id
                FROM requests r JOIN units u ON u.id = r.unit_id
                WHERE r.id = NEW.request_id
                UNION ALL
                SELECT parent.id, parent.parent_id
                FROM units parent JOIN ancestry child ON child.parent_id = parent.id
            )
            SELECT id INTO request_department_id FROM ancestry WHERE parent_id IS NULL LIMIT 1;

            SELECT unit_id, parent_id INTO catalog_department_id, catalog_parent_id
            FROM dds_catalog WHERE id = NEW.dds_id;
            IF catalog_department_id IS NULL THEN
                SELECT unit_id, parent_id INTO catalog_department_id, catalog_parent_id
                FROM invests_catalog WHERE id = NEW.invest_id;
            END IF;
            IF NEW.status <> 'deleted' AND catalog_parent_id IS NULL THEN
                RAISE EXCEPTION 'Request line must reference a catalog category';
            END IF;
            IF NEW.status <> 'deleted' AND catalog_department_id IS DISTINCT FROM request_department_id THEN
                RAISE EXCEPTION 'Request line catalog entry belongs to another department';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    # Existing request references cannot be safely collapsed without losing the
    # category selected by a user.
    pass
