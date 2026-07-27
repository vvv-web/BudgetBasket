"""request lines, request chat, audit log and unit annual budgets

Revision ID: 20260717_0006
Revises: 20260714_0005
Create Date: 2026-07-17
"""

from alembic import op


revision = "20260717_0006"
down_revision = "20260714_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Unit mode and spending limit. Existing units continue in the DDS mode.
    op.execute("ALTER TABLE units ADD COLUMN uses_invest_projects boolean NOT NULL DEFAULT false")
    op.execute("ALTER TABLE units ADD COLUMN annual_budget numeric(14,2) NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE units ADD CONSTRAINT units_annual_budget_chk CHECK (annual_budget >= 0)")

    # A request now stores both its planned and actual total. The legacy sum is
    # retained only until values have been backfilled and is removed below.
    op.execute("ALTER TABLE requests ADD COLUMN sum_plan numeric(14,2) NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE requests ADD COLUMN sum_fact numeric(14,2) NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE requests RENAME COLUMN budget_frozen TO frozen")
    op.execute("ALTER TABLE requests ADD CONSTRAINT requests_sum_plan_chk CHECK (sum_plan >= 0)")
    op.execute("ALTER TABLE requests ADD CONSTRAINT requests_sum_fact_chk CHECK (sum_fact >= 0)")

    # A catalogue can now be global. The UI still scopes its normal selection
    # to a department, but global records remain available to every unit.
    op.execute("ALTER TABLE dds_catalog ALTER COLUMN unit_id DROP NOT NULL")
    op.execute("ALTER TABLE invests_catalog ALTER COLUMN unit_id DROP NOT NULL")
    op.execute("ALTER TABLE dds_catalog DROP CONSTRAINT dds_catalog_unit_id_fkey")
    op.execute("ALTER TABLE invests_catalog DROP CONSTRAINT invests_catalog_unit_id_fkey")
    op.execute("ALTER TABLE dds_catalog ADD CONSTRAINT dds_catalog_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE invests_catalog ADD CONSTRAINT invests_catalog_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_email_key")
    op.execute("ALTER TABLE storage_objects DROP CONSTRAINT IF EXISTS storage_objects_content_sha256_key")

    op.execute(
        """
        CREATE TABLE req_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            dds_id uuid REFERENCES dds_catalog(id) ON DELETE RESTRICT,
            invest_id uuid REFERENCES invests_catalog(id) ON DELETE RESTRICT,
            name text NOT NULL,
            sum_plan numeric(14,2) NOT NULL DEFAULT 0,
            sum_fact numeric(14,2) NOT NULL DEFAULT 0,
            justification text NOT NULL DEFAULT '',
            status text NOT NULL DEFAULT 'on_review',
            comment text NOT NULL DEFAULT '',
            CONSTRAINT req_items_sum_plan_chk CHECK (sum_plan >= 0),
            CONSTRAINT req_items_sum_fact_chk CHECK (sum_fact >= 0),
            CONSTRAINT req_items_status_chk CHECK (status IN ('on_review', 'rejected', 'approved_with_changes', 'approved', 'deleted')),
            CONSTRAINT req_items_article_chk CHECK (dds_id IS NOT NULL OR invest_id IS NOT NULL)
        )
        """
    )
    op.execute("CREATE INDEX idx_req_items_request_id ON req_items(request_id)")
    op.execute("CREATE INDEX idx_req_items_dds_id ON req_items(dds_id)")
    op.execute("CREATE INDEX idx_req_items_invest_id ON req_items(invest_id)")
    op.execute("CREATE INDEX idx_req_items_status ON req_items(status)")

    # Copy all historical lines and their attachments without changing IDs.
    op.execute(
        """
        INSERT INTO req_items (id, request_id, dds_id, name, sum_plan, sum_fact, status, comment)
        SELECT item.id, item.request_id, item.dds_id, catalog.name, item.sum_plan,
               COALESCE(item.sum_fact, 0), item.status, COALESCE(item.comment, '')
        FROM dds_items AS item
        JOIN dds_catalog AS catalog ON catalog.id = item.dds_id
        """
    )
    op.execute(
        """
        INSERT INTO req_items (id, request_id, invest_id, name, sum_plan, sum_fact, status, comment)
        SELECT item.id, item.request_id, item.invest_id, catalog.name, item.sum_plan,
               COALESCE(item.sum_fact, 0), item.status, COALESCE(item.comment, '')
        FROM invest_items AS item
        JOIN invests_catalog AS catalog ON catalog.id = item.invest_id
        """
    )
    op.execute(
        """
        CREATE TABLE req_item_files (
            file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            req_item_id uuid NOT NULL REFERENCES req_items(id) ON DELETE CASCADE,
            PRIMARY KEY (file_id, req_item_id)
        )
        """
    )
    op.execute("CREATE INDEX idx_req_item_files_req_item_id ON req_item_files(req_item_id)")
    op.execute("INSERT INTO req_item_files (file_id, req_item_id) SELECT file_id, dds_item_id FROM dds_item_files")
    op.execute("INSERT INTO req_item_files (file_id, req_item_id) SELECT file_id, invest_item_id FROM invest_item_files")

    op.execute(
        """
        UPDATE requests AS request
        SET sum_plan = totals.sum_plan, sum_fact = totals.sum_fact
        FROM (
            SELECT request_id, COALESCE(SUM(sum_plan), 0) AS sum_plan, COALESCE(SUM(sum_fact), 0) AS sum_fact
            FROM req_items
            GROUP BY request_id
        ) AS totals
        WHERE request.id = totals.request_id
        """
    )
    op.execute("ALTER TABLE requests DROP COLUMN sum")

    op.execute(
        """
        CREATE TABLE req_chats (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            req_id uuid NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE TABLE chat_messages (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id uuid NOT NULL REFERENCES req_chats(id) ON DELETE CASCADE,
            reply_to uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
            sender_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            text text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_chat_messages_chat_id_created_at ON chat_messages(chat_id, created_at)")
    op.execute("CREATE INDEX idx_chat_messages_reply_to ON chat_messages(reply_to)")
    op.execute(
        """
        CREATE TABLE chats_participants (
            chat_id uuid NOT NULL REFERENCES req_chats(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            last_read_message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
            PRIMARY KEY (chat_id, user_id)
        )
        """
    )
    op.execute("CREATE INDEX idx_chats_participants_user_id ON chats_participants(user_id)")
    op.execute(
        """
        CREATE TABLE req_logs (
            id bigserial PRIMARY KEY,
            req_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            log jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_req_logs_req_id_created_at ON req_logs(req_id, created_at)")
    op.execute("CREATE INDEX idx_req_logs_user_id ON req_logs(user_id)")

    op.execute("DROP TABLE dds_item_files")
    op.execute("DROP TABLE invest_item_files")
    op.execute("DROP TABLE dds_items")
    op.execute("DROP TABLE invest_items")
    op.execute("DROP TABLE unit_dds_mappings")
    op.execute("DROP TABLE unit_invest_mappings")


def downgrade() -> None:
    raise NotImplementedError("The v1-17 migration merges historical rows and is intentionally irreversible.")
