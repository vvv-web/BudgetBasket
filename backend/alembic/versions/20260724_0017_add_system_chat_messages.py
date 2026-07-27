"""add system chat message marker

Revision ID: 20260724_0017
Revises: 20260723_0016
Create Date: 2026-07-24
"""

from alembic import op
import sqlalchemy as sa


revision = "20260724_0017"
down_revision = "20260723_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.alter_column("chat_messages", "sender_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM chat_messages WHERE is_system = true")
    op.alter_column("chat_messages", "sender_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("chat_messages", "is_system")
