"""add image attachments to chat messages

Revision ID: 20260728_0019
Revises: 20260727_0018
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa


revision = "20260728_0019"
down_revision = "20260727_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "message_files",
        sa.Column("file_id", sa.BigInteger(), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.UUID(), sa.ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("file_id", "message_id"),
    )
    op.create_index("idx_message_files_message_id", "message_files", ["message_id"])


def downgrade() -> None:
    op.drop_index("idx_message_files_message_id", table_name="message_files")
    op.drop_table("message_files")
