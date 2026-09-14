"""replace request-bound chats with unit-year conversations

Revision ID: 20260805_0023
Revises: 20260804_0022
Create Date: 2026-08-05
"""

from alembic import op


revision = "20260805_0023"
down_revision = "20260804_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Development data is deliberately discarded.  A legacy request chat mixed
    # participants of both new channels, therefore duplicating its messages
    # would break the new access boundary.
    op.execute("DROP TABLE IF EXISTS message_files")
    op.execute("DROP TABLE IF EXISTS chats_participants")
    op.execute("DROP TABLE IF EXISTS chat_messages")
    op.execute("DROP TABLE IF EXISTS req_chats")
    op.execute(
        """
        CREATE TABLE chats (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            kind text NOT NULL CHECK (kind IN ('module_cfo', 'cfo_economist')),
            unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
            budget_year smallint NOT NULL CHECK (budget_year BETWEEN 2000 AND 2200),
            CONSTRAINT ux_chats_kind_unit_budget_year UNIQUE (kind, unit_id, budget_year)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE chat_messages (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            reply_to uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
            sender_id uuid REFERENCES users(id) ON DELETE RESTRICT,
            text text NOT NULL,
            is_system boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_chat_messages_chat_id_created_at ON chat_messages(chat_id, created_at)")
    op.execute("CREATE INDEX idx_chat_messages_reply_to ON chat_messages(reply_to)")
    op.execute(
        """
        CREATE TABLE chats_participants (
            chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            last_read_message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
            PRIMARY KEY (chat_id, user_id)
        )
        """
    )
    op.execute("CREATE INDEX idx_chats_participants_user_id ON chats_participants(user_id)")
    op.execute(
        """
        CREATE TABLE message_files (
            file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
            PRIMARY KEY (file_id, message_id)
        )
        """
    )
    op.execute("CREATE INDEX idx_message_files_message_id ON message_files(message_id)")


def downgrade() -> None:
    raise NotImplementedError("The development chat reset is intentionally irreversible.")
