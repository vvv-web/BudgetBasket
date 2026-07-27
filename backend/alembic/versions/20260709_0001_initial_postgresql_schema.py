"""initial postgresql schema

Revision ID: 20260709_0001
Revises:
Create Date: 2026-07-09

The initial revision is intentionally self-contained. Importing the live
application metadata here would make a clean migration create today's schema
and then run historical transformations against it.
"""

from alembic import op


revision = "20260709_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        """
        CREATE TABLE users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            login text NOT NULL UNIQUE,
            password text NOT NULL,
            role text NOT NULL,
            CONSTRAINT users_role_chk CHECK (role IN ('admin', 'economist', 'employee'))
        );
        CREATE TABLE profiles (
            user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            name text NOT NULL,
            second_name text,
            last_name text NOT NULL,
            phone text,
            email text UNIQUE,
            max_link text
        );
        CREATE TABLE units (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            parent_id uuid REFERENCES units(id) ON DELETE SET NULL,
            name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE units_responsibles (
            unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            is_active boolean NOT NULL DEFAULT true,
            PRIMARY KEY (unit_id, user_id)
        );
        CREATE TABLE requests (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            economist_id uuid REFERENCES users(id) ON DELETE SET NULL,
            unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
            sum numeric(14,2) NOT NULL DEFAULT 0,
            status text NOT NULL DEFAULT 'draft',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT requests_sum_chk CHECK (sum >= 0),
            CONSTRAINT requests_status_chk CHECK (
                status IN (
                    'draft',
                    'on_review',
                    'approved',
                    'approved_with_changes',
                    'partially_approved',
                    'rejected',
                    'cancelled'
                )
            )
        );
        CREATE TABLE dds_catalog (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            parent_id uuid REFERENCES dds_catalog(id) ON DELETE SET NULL,
            unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
            name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE invests_catalog (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            parent_id uuid REFERENCES invests_catalog(id) ON DELETE SET NULL,
            unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
            name text NOT NULL,
            is_active boolean NOT NULL DEFAULT true
        );
        CREATE TABLE dds_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            dds_id uuid NOT NULL REFERENCES dds_catalog(id) ON DELETE RESTRICT,
            category_id uuid REFERENCES dds_catalog(id) ON DELETE RESTRICT,
            sum_plan numeric(14,2) NOT NULL,
            sum_fact numeric(14,2),
            status text NOT NULL DEFAULT 'on_review',
            comment text,
            CONSTRAINT dds_items_sum_plan_chk CHECK (sum_plan >= 0),
            CONSTRAINT dds_items_sum_fact_chk CHECK (sum_fact IS NULL OR sum_fact >= 0),
            CONSTRAINT dds_items_status_chk CHECK (
                status IN ('on_review', 'rejected', 'approved_with_changes', 'approved')
            )
        );
        CREATE TABLE invest_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            invest_id uuid NOT NULL REFERENCES invests_catalog(id) ON DELETE RESTRICT,
            category_id uuid REFERENCES invests_catalog(id) ON DELETE RESTRICT,
            sum_plan numeric(14,2) NOT NULL,
            sum_fact numeric(14,2),
            status text NOT NULL DEFAULT 'on_review',
            comment text,
            CONSTRAINT invest_items_sum_plan_chk CHECK (sum_plan >= 0),
            CONSTRAINT invest_items_sum_fact_chk CHECK (sum_fact IS NULL OR sum_fact >= 0),
            CONSTRAINT invest_items_status_chk CHECK (
                status IN ('on_review', 'rejected', 'approved_with_changes', 'approved')
            )
        );
        CREATE TABLE storage_objects (
            id bigserial PRIMARY KEY,
            storage_bucket text NOT NULL,
            storage_key text NOT NULL UNIQUE,
            content_sha256 text NOT NULL UNIQUE,
            mime_type text NOT NULL,
            size_bytes bigint NOT NULL,
            CONSTRAINT storage_objects_size_chk CHECK (size_bytes >= 0)
        );
        CREATE TABLE files (
            id bigserial PRIMARY KEY,
            id_storage_object bigint NOT NULL REFERENCES storage_objects(id) ON DELETE RESTRICT,
            original_name text NOT NULL
        );
        CREATE TABLE dds_item_files (
            file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            dds_item_id uuid NOT NULL REFERENCES dds_items(id) ON DELETE CASCADE,
            PRIMARY KEY (file_id, dds_item_id)
        );
        CREATE TABLE invest_item_files (
            file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            invest_item_id uuid NOT NULL REFERENCES invest_items(id) ON DELETE CASCADE,
            PRIMARY KEY (file_id, invest_item_id)
        );
        CREATE TABLE unit_dds_mappings (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
            local_name text NOT NULL,
            local_code text,
            is_active boolean NOT NULL DEFAULT true,
            dds_id uuid REFERENCES dds_catalog(id) ON DELETE SET NULL
        );
        CREATE TABLE unit_invest_mappings (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
            local_name text NOT NULL,
            local_code text,
            is_active boolean NOT NULL DEFAULT true,
            invest_id uuid REFERENCES invests_catalog(id) ON DELETE SET NULL
        );

        CREATE INDEX idx_users_role ON users(role);
        CREATE INDEX idx_units_parent_id ON units(parent_id);
        CREATE INDEX idx_units_is_active ON units(is_active);
        CREATE INDEX idx_units_responsibles_user_id ON units_responsibles(user_id);
        CREATE INDEX idx_units_responsibles_active ON units_responsibles(is_active);
        CREATE INDEX idx_requests_unit_id ON requests(unit_id);
        CREATE INDEX idx_requests_economist_id ON requests(economist_id);
        CREATE INDEX idx_requests_status ON requests(status);
        CREATE INDEX idx_dds_catalog_unit_id ON dds_catalog(unit_id);
        CREATE INDEX idx_dds_catalog_parent_id ON dds_catalog(parent_id);
        CREATE INDEX idx_dds_catalog_active ON dds_catalog(is_active);
        CREATE INDEX idx_invests_catalog_unit_id ON invests_catalog(unit_id);
        CREATE INDEX idx_invests_catalog_parent_id ON invests_catalog(parent_id);
        CREATE INDEX idx_invests_catalog_active ON invests_catalog(is_active);
        CREATE INDEX idx_dds_items_request_id ON dds_items(request_id);
        CREATE INDEX idx_dds_items_status ON dds_items(status);
        CREATE INDEX idx_invest_items_request_id ON invest_items(request_id);
        CREATE INDEX idx_invest_items_status ON invest_items(status);
        CREATE INDEX idx_storage_objects_storage_key ON storage_objects(storage_key);
        CREATE INDEX idx_storage_objects_content_sha256 ON storage_objects(content_sha256);
        CREATE INDEX idx_files_storage_object ON files(id_storage_object);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS unit_invest_mappings CASCADE;
        DROP TABLE IF EXISTS unit_dds_mappings CASCADE;
        DROP TABLE IF EXISTS invest_item_files CASCADE;
        DROP TABLE IF EXISTS dds_item_files CASCADE;
        DROP TABLE IF EXISTS files CASCADE;
        DROP TABLE IF EXISTS storage_objects CASCADE;
        DROP TABLE IF EXISTS invest_items CASCADE;
        DROP TABLE IF EXISTS dds_items CASCADE;
        DROP TABLE IF EXISTS invests_catalog CASCADE;
        DROP TABLE IF EXISTS dds_catalog CASCADE;
        DROP TABLE IF EXISTS requests CASCADE;
        DROP TABLE IF EXISTS units_responsibles CASCADE;
        DROP TABLE IF EXISTS units CASCADE;
        DROP TABLE IF EXISTS profiles CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
        """
    )
