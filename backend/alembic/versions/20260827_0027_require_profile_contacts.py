"""require profile contacts

Revision ID: 20260827_0027
Revises: 20260807_0026
Create Date: 2026-08-27
"""

from alembic import op
import sqlalchemy as sa


revision = "20260827_0027"
down_revision = "20260807_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing profiles may predate mandatory contacts. Keep migration safe;
    # API validation prevents new empty values.
    op.execute("UPDATE profiles SET phone = '' WHERE phone IS NULL")
    op.execute("UPDATE profiles SET email = '' WHERE email IS NULL")
    op.alter_column("profiles", "phone", existing_type=sa.Text(), nullable=False)
    op.alter_column("profiles", "email", existing_type=sa.Text(), nullable=False)


def downgrade() -> None:
    op.alter_column("profiles", "email", existing_type=sa.Text(), nullable=True)
    op.alter_column("profiles", "phone", existing_type=sa.Text(), nullable=True)
