"""normalize catalog hierarchy and item categories

Revision ID: 20260710_0004
Revises: 20260709_0003
Create Date: 2026-07-10
"""

from alembic import op


revision = "20260710_0004"
down_revision = "20260709_0003"
branch_labels = None
depends_on = None


def _normalize(collection: str, items: str, article_field: str) -> None:
    op.execute(
        f"""
        WITH RECURSIVE hierarchy AS (
            SELECT id, id AS root_id
            FROM {collection}
            WHERE parent_id IS NULL
            UNION ALL
            SELECT child.id, hierarchy.root_id
            FROM {collection} AS child
            JOIN hierarchy ON child.parent_id = hierarchy.id
        )
        UPDATE {collection} AS item
        SET parent_id = hierarchy.root_id
        FROM hierarchy
        WHERE item.id = hierarchy.id
          AND item.parent_id IS NOT NULL
          AND item.parent_id <> hierarchy.root_id
          AND NOT EXISTS (
              SELECT 1
              FROM {collection} AS sibling
              WHERE sibling.parent_id = hierarchy.root_id
                AND sibling.id <> item.id
                AND sibling.unit_id = item.unit_id
                AND sibling.name = item.name
          )
        """
    )
    op.execute(
        f"""
        UPDATE {items} AS item
        SET category_id = article.parent_id
        FROM {collection} AS article
        WHERE item.{article_field} = article.id
          AND article.parent_id IS NOT NULL
          AND item.category_id IS DISTINCT FROM article.parent_id
        """
    )


def upgrade() -> None:
    _normalize("dds_catalog", "dds_items", "dds_id")
    _normalize("invests_catalog", "invest_items", "invest_id")


def downgrade() -> None:
    pass
