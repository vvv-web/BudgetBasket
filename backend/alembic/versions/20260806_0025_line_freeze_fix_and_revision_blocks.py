"""move CFO freeze/fix flags to request lines

Revision ID: 20260806_0025
Revises: 20260805_0024
Create Date: 2026-08-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260806_0025"
down_revision = "20260805_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("req_items", sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("req_items", sa.Column("fixed", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.execute(
        """
        UPDATE req_items item
        SET frozen = position.frozen,
            fixed = position.fixed
        FROM cfo_positions position
        WHERE item.cfo_position_id = position.id
          AND item.status <> 'deleted'
        """
    )
    op.create_check_constraint("req_items_fixed_requires_frozen_chk", "req_items", "NOT fixed OR frozen")
    op.drop_constraint("cfo_positions_fixed_requires_frozen_chk", "cfo_positions", type_="check")
    op.drop_column("cfo_positions", "fixed")
    op.drop_column("cfo_positions", "frozen")

def downgrade() -> None:
    op.add_column("cfo_positions", sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("cfo_positions", sa.Column("fixed", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.execute(
        """
        UPDATE cfo_positions position
        SET frozen = COALESCE((SELECT bool_and(item.frozen) FROM req_items item WHERE item.cfo_position_id = position.id AND item.status <> 'deleted'), false),
            fixed = COALESCE((SELECT bool_and(item.fixed) FROM req_items item WHERE item.cfo_position_id = position.id AND item.status <> 'deleted'), false)
        """
    )
    op.create_check_constraint("cfo_positions_fixed_requires_frozen_chk", "cfo_positions", "NOT fixed OR frozen")
    op.drop_constraint("req_items_fixed_requires_frozen_chk", "req_items", type_="check")
    op.drop_column("req_items", "fixed")
    op.drop_column("req_items", "frozen")
