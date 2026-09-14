"""add safe-file metadata

Revision ID: 20260805_0024
Revises: 20260805_0023
Create Date: 2026-08-05
"""

from alembic import op


revision = "20260805_0024"
down_revision = "20260805_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE files ADD COLUMN stored_name text")
    op.execute("ALTER TABLE files ADD COLUMN is_sanitized boolean NOT NULL DEFAULT false")
    op.execute("ALTER TABLE files ADD COLUMN sanitization_report jsonb")
    op.execute("UPDATE files SET stored_name = original_name WHERE stored_name IS NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE files DROP COLUMN sanitization_report")
    op.execute("ALTER TABLE files DROP COLUMN is_sanitized")
    op.execute("ALTER TABLE files DROP COLUMN stored_name")
