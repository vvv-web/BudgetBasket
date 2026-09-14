-- BudgetBasket v2-23 reference schema (PostgreSQL)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE roles (
    id bigserial PRIMARY KEY,
    name text NOT NULL UNIQUE
);
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), login text NOT NULL UNIQUE,
    password text NOT NULL,
    id_role bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT
);
CREATE TABLE profiles (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL, second_name text, last_name text NOT NULL, phone text NOT NULL, email text NOT NULL, max_link text
);
CREATE TABLE units (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid REFERENCES units(id) ON DELETE SET NULL,
    name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
    uses_invest_projects boolean NOT NULL DEFAULT false,
    annual_budget numeric(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT units_annual_budget_chk CHECK (annual_budget >= 0)
);
CREATE TABLE units_responsibles (
    unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active boolean NOT NULL DEFAULT true, PRIMARY KEY (unit_id, user_id)
);

CREATE TABLE dds_catalog (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid REFERENCES dds_catalog(id) ON DELETE SET NULL,
    unit_id uuid REFERENCES units(id) ON DELETE SET NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE invests_catalog (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid REFERENCES invests_catalog(id) ON DELETE SET NULL,
    unit_id uuid REFERENCES units(id) ON DELETE SET NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    budget_year bigint NOT NULL CHECK (budget_year BETWEEN 2000 AND 2200),
    status text NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT requests_status_chk CHECK (status IN ('draft', 'on_review', 'approved', 'rejected', 'cancelled'))
);
CREATE TABLE cfo_positions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_year bigint NOT NULL CHECK (budget_year BETWEEN 2000 AND 2200),
    cfo_unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    dds_id uuid REFERENCES dds_catalog(id) ON DELETE RESTRICT,
    invest_id uuid REFERENCES invests_catalog(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'waiting',
    current_step_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cfo_positions_article_chk CHECK ((dds_id IS NULL) <> (invest_id IS NULL)),
    CONSTRAINT cfo_positions_status_chk CHECK (status IN ('waiting', 'on_review', 'on_approval', 'approved', 'on_revision'))
);
CREATE TABLE req_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    cfo_position_id uuid REFERENCES cfo_positions(id) ON DELETE RESTRICT,
    dds_id uuid REFERENCES dds_catalog(id) ON DELETE RESTRICT,
    invest_id uuid REFERENCES invests_catalog(id) ON DELETE RESTRICT,
    is_income boolean NOT NULL DEFAULT false,
    name text NOT NULL, sum_plan numeric(14,2) NOT NULL DEFAULT 0, sum_fact numeric(14,2) NOT NULL DEFAULT 0,
    justification text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'on_review', comment text NOT NULL DEFAULT '',
    analytics_1 text NOT NULL DEFAULT '', analytics_2 text NOT NULL DEFAULT '', analytics_3 text NOT NULL DEFAULT '',
    analytics_4 text NOT NULL DEFAULT '', analytics_5 text NOT NULL DEFAULT '',
    frozen boolean NOT NULL DEFAULT false, fixed boolean NOT NULL DEFAULT false,
    CONSTRAINT req_items_sum_plan_chk CHECK (sum_plan >= 0),
    CONSTRAINT req_items_sum_fact_chk CHECK (sum_fact >= 0),
    CONSTRAINT req_items_status_chk CHECK (status IN ('on_review', 'rejected', 'approved_with_changes', 'approved', 'deleted')),
    CONSTRAINT req_items_article_chk CHECK ((dds_id IS NULL) <> (invest_id IS NULL)),
    CONSTRAINT req_items_fixed_requires_frozen_chk CHECK (NOT fixed OR frozen)
);
CREATE TABLE req_item_month_plans (
    req_item_id uuid NOT NULL REFERENCES req_items(id) ON DELETE CASCADE,
    month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    sum_plan numeric(14,2) NOT NULL DEFAULT 0 CHECK (sum_plan >= 0),
    PRIMARY KEY (req_item_id, month)
);

CREATE TABLE storage_objects (
    id bigserial PRIMARY KEY, storage_bucket text NOT NULL, storage_key text NOT NULL UNIQUE,
    content_sha256 text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL,
    CONSTRAINT storage_objects_size_chk CHECK (size_bytes >= 0)
);
CREATE TABLE files (
    id bigserial PRIMARY KEY, id_storage_object bigint NOT NULL REFERENCES storage_objects(id) ON DELETE RESTRICT,
    original_name text NOT NULL,
    stored_name text,
    is_sanitized boolean NOT NULL DEFAULT false,
    sanitization_report jsonb
);
CREATE TABLE req_item_files (
    file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    req_item_id uuid NOT NULL REFERENCES req_items(id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, req_item_id)
);

CREATE TABLE chats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('module_cfo', 'cfo_economist')),
    unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    budget_year smallint NOT NULL CHECK (budget_year BETWEEN 2000 AND 2200),
    CONSTRAINT ux_chats_kind_unit_budget_year UNIQUE (kind, unit_id, budget_year)
);
CREATE TABLE chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    reply_to uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
    sender_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    text text NOT NULL, is_system boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE message_files (
    file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, message_id)
);
CREATE TABLE chats_participants (
    chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
    PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE req_logs (
    id bigserial PRIMARY KEY, req_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    log jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    unit_id uuid REFERENCES units(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'waiting',
    CONSTRAINT steps_status_chk CHECK (
        status IN ('waiting', 'on_approval', 'on_revision', 'approved', 'closed')
    )
);
ALTER TABLE cfo_positions
    ADD CONSTRAINT cfo_positions_current_step_id_fkey
    FOREIGN KEY (current_step_id) REFERENCES steps(id) ON DELETE SET NULL;
CREATE TABLE step_edges (
    parent_step_id uuid NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    child_step_id uuid NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    PRIMARY KEY (parent_step_id, child_step_id),
    CONSTRAINT step_edges_no_self_chk CHECK (parent_step_id <> child_step_id)
);
CREATE TABLE step_logs (
    id bigserial PRIMARY KEY,
    step_id uuid REFERENCES steps(id) ON DELETE SET NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    log jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cfo_position_logs (
    id bigserial PRIMARY KEY,
    cfo_position_id uuid NOT NULL REFERENCES cfo_positions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    step_id uuid REFERENCES steps(id) ON DELETE SET NULL,
    log jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL,
    payload jsonb NOT NULL,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_id_role ON users(id_role);
CREATE INDEX idx_units_parent_id ON units(parent_id);
CREATE INDEX idx_units_is_active ON units(is_active);
CREATE INDEX idx_units_responsibles_user_id ON units_responsibles(user_id);
CREATE INDEX idx_units_responsibles_active ON units_responsibles(is_active);
CREATE INDEX idx_dds_catalog_parent_id ON dds_catalog(parent_id);
CREATE INDEX idx_dds_catalog_unit_id ON dds_catalog(unit_id);
CREATE INDEX idx_dds_catalog_active ON dds_catalog(is_active);
CREATE INDEX idx_invests_catalog_parent_id ON invests_catalog(parent_id);
CREATE INDEX idx_invests_catalog_unit_id ON invests_catalog(unit_id);
CREATE INDEX idx_invests_catalog_active ON invests_catalog(is_active);
CREATE INDEX idx_requests_unit_id ON requests(unit_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE UNIQUE INDEX ux_requests_active_unit_budget_year
ON requests(unit_id, budget_year)
WHERE status <> 'cancelled';
CREATE INDEX idx_req_items_request_id ON req_items(request_id);
CREATE INDEX idx_req_items_cfo_position_id ON req_items(cfo_position_id);
CREATE INDEX idx_req_items_dds_id ON req_items(dds_id);
CREATE INDEX idx_req_items_invest_id ON req_items(invest_id);
CREATE INDEX idx_req_items_status ON req_items(status);
CREATE INDEX idx_req_items_is_income ON req_items(is_income);
CREATE INDEX idx_files_storage_object ON files(id_storage_object);
CREATE INDEX idx_req_item_files_req_item_id ON req_item_files(req_item_id);
CREATE INDEX idx_storage_objects_storage_key ON storage_objects(storage_key);
CREATE INDEX idx_storage_objects_content_sha256 ON storage_objects(content_sha256);
CREATE INDEX idx_chat_messages_chat_id_created_at ON chat_messages(chat_id, created_at);
CREATE INDEX idx_chat_messages_reply_to ON chat_messages(reply_to);
CREATE INDEX idx_message_files_message_id ON message_files(message_id);
CREATE INDEX idx_chats_participants_user_id ON chats_participants(user_id);
CREATE INDEX idx_req_logs_req_id_created_at ON req_logs(req_id, created_at);
CREATE INDEX idx_req_logs_user_id ON req_logs(user_id);
CREATE INDEX idx_steps_user_status ON steps(user_id, status);
CREATE UNIQUE INDEX ux_steps_unit_not_null ON steps(unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX idx_step_edges_child ON step_edges(child_step_id);
CREATE INDEX idx_step_logs_step_created_at ON step_logs(step_id, created_at DESC);
CREATE INDEX idx_step_logs_user_id ON step_logs(user_id);
CREATE INDEX idx_step_logs_action ON step_logs((log->>'action'));
CREATE INDEX idx_cfo_positions_cfo_year ON cfo_positions(cfo_unit_id, budget_year);
CREATE INDEX idx_cfo_positions_status ON cfo_positions(status);
CREATE INDEX idx_cfo_positions_current_step ON cfo_positions(current_step_id);
CREATE UNIQUE INDEX ux_cfo_positions_dds
    ON cfo_positions(budget_year, cfo_unit_id, dds_id)
    WHERE dds_id IS NOT NULL;
CREATE UNIQUE INDEX ux_cfo_positions_invest
    ON cfo_positions(budget_year, cfo_unit_id, invest_id)
    WHERE invest_id IS NOT NULL;
CREATE INDEX idx_cfo_position_logs_position_created ON cfo_position_logs(cfo_position_id, created_at);
CREATE INDEX idx_cfo_position_logs_step_id ON cfo_position_logs(step_id);
CREATE INDEX idx_cfo_position_logs_user_id ON cfo_position_logs(user_id);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read_at);
CREATE UNIQUE INDEX ux_dds_catalog_scope_name ON dds_catalog (unit_id, parent_id, lower(name)) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX ux_invests_catalog_scope_name ON invests_catalog (unit_id, parent_id, lower(name)) NULLS NOT DISTINCT;

CREATE FUNCTION set_requests_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_requests_updated_at BEFORE UPDATE ON requests
FOR EACH ROW EXECUTE FUNCTION set_requests_updated_at();

CREATE FUNCTION validate_req_item_catalog_mode() RETURNS trigger AS $$
DECLARE
    unit_uses_invest_projects boolean;
BEGIN
    SELECT u.uses_invest_projects INTO unit_uses_invest_projects
    FROM requests r JOIN units u ON u.id = r.unit_id
    WHERE r.id = NEW.request_id;

    IF NEW.status <> 'deleted' AND (
        (unit_uses_invest_projects AND NEW.dds_id IS NOT NULL) OR
        (NOT unit_uses_invest_projects AND NEW.invest_id IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'Request line type does not match the unit mode';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_req_items_catalog_mode
BEFORE INSERT OR UPDATE OF request_id, dds_id, invest_id, status ON req_items
FOR EACH ROW EXECUTE FUNCTION validate_req_item_catalog_mode();

CREATE FUNCTION validate_unit_catalog_mode() RETURNS trigger AS $$
BEGIN
    IF NEW.uses_invest_projects IS DISTINCT FROM OLD.uses_invest_projects AND EXISTS (
        SELECT 1
        FROM requests r
        JOIN req_items ri ON ri.request_id = r.id
        WHERE r.unit_id = NEW.id
          AND ri.status <> 'deleted'
          AND ((NEW.uses_invest_projects AND ri.dds_id IS NOT NULL)
               OR (NOT NEW.uses_invest_projects AND ri.invest_id IS NOT NULL))
    ) THEN
        RAISE EXCEPTION 'Cannot change unit mode while active request lines use the other type';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_units_catalog_mode
BEFORE UPDATE OF uses_invest_projects ON units
FOR EACH ROW EXECUTE FUNCTION validate_unit_catalog_mode();

CREATE FUNCTION validate_req_item_catalog_department() RETURNS trigger AS $$
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
    SELECT id INTO request_department_id
    FROM ancestry
    WHERE parent_id IS NULL
    LIMIT 1;
    SELECT unit_id, parent_id INTO catalog_department_id, catalog_parent_id FROM dds_catalog WHERE id = NEW.dds_id;
    IF catalog_department_id IS NULL THEN
        SELECT unit_id, parent_id INTO catalog_department_id, catalog_parent_id FROM invests_catalog WHERE id = NEW.invest_id;
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
CREATE TRIGGER trg_req_items_catalog_department
BEFORE INSERT OR UPDATE OF request_id, dds_id, invest_id, status ON req_items
FOR EACH ROW EXECUTE FUNCTION validate_req_item_catalog_department();
