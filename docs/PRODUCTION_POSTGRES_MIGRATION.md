# DISRUPTIONIQ — Production PostgreSQL Migration Guide

This document outlines the architecture and migration plan for transitioning DISRUPTIONIQ from the single-host SQLite engine to a hosted, multi-instance persistent PostgreSQL database (such as Neon, Supabase, AWS Aurora Serverless, or Google Cloud SQL) for full enterprise Vercel production deployment.

---

## 1. Architecture Overview

### Current Development Architecture
- **Engine**: Node.js native `node:sqlite` (`DatabaseSync`).
- **Storage**: Local filesystem (`./instance/disruptioniq.db`) or ephemeral lambda scratch space (`/tmp/disruptioniq.db` on Vercel).
- **Execution**: Synchronous SQLite statement preparation and query execution (`get`, `all`, `run`).
- **Concurrency**: Process-level WAL mode with single-writer, multi-reader semantics.

### Production Vercel Architecture (PostgreSQL)
- **Engine**: Hosted PostgreSQL (e.g. Neon serverless Postgres with connection pooling).
- **Driver**: `@neondatabase/serverless` or `pg` / `postgres`.
- **Concurrency**: Native multi-tenant, ACID transaction isolation with connection pooler (PgBouncer).
- **Persistence**: Durable distributed storage surviving function cold-starts, scale-down to zero, and horizontal scaling.

---

## 2. PostgreSQL DDL Schema Specification

The following DDL establishes identical tables, primary keys, foreign keys, and indexes matching the DISRUPTIONIQ domain model in PostgreSQL:

```sql
-- 1. Customers
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    customer_code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users & Authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(120) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'HUB_INCHARGE',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    full_name VARCHAR(255),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_customer ON users(customer_id);

-- 3. Carriers
CREATE TABLE IF NOT EXISTS carriers (
    carrier_code VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    service_type VARCHAR(64),
    tracking_prefix VARCHAR(32),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'synthetic'
);

-- 4. Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(100),
    city VARCHAR(100),
    state VARCHAR(100),
    reliability_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    lead_time_days INTEGER NOT NULL DEFAULT 7,
    expected_supply_date TIMESTAMPTZ,
    contact_email VARCHAR(255),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    region VARCHAR(64),
    risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    exposure TEXT,
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);

-- 5. Warehouses / Hubs
CREATE TABLE IF NOT EXISTS warehouses (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    capacity_sqm DOUBLE PRECISION NOT NULL DEFAULT 0,
    capacity_units INTEGER NOT NULL DEFAULT 0,
    current_utilization DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);

-- 6. Inventories
CREATE TABLE IF NOT EXISTS inventories (
    id SERIAL PRIMARY KEY,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    sku VARCHAR(64) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    reorder_point INTEGER NOT NULL DEFAULT 10,
    unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_record_id VARCHAR(120),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational',
    UNIQUE (warehouse_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse ON inventories(warehouse_id);

-- 7. Shipments
CREATE TABLE IF NOT EXISTS shipments (
    id SERIAL PRIMARY KEY,
    tracking_number VARCHAR(120) NOT NULL UNIQUE,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    origin_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
    destination_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
    carrier VARCHAR(100),
    carrier_code VARCHAR(32),
    transport_mode VARCHAR(64) NOT NULL DEFAULT 'Ocean',
    status VARCHAR(64) NOT NULL DEFAULT 'In Transit',
    origin_city VARCHAR(100),
    destination_city VARCHAR(100),
    estimated_departure TIMESTAMPTZ,
    actual_departure TIMESTAMPTZ,
    estimated_arrival TIMESTAMPTZ,
    actual_arrival TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ui_status VARCHAR(64),
    risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    progress DOUBLE PRECISION NOT NULL DEFAULT 0,
    unit_count INTEGER NOT NULL DEFAULT 0,
    eta_label VARCHAR(64),
    source_record_id VARCHAR(120),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);

-- 8. Shipment Items
CREATE TABLE IF NOT EXISTS shipment_items (
    id SERIAL PRIMARY KEY,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    sku VARCHAR(64) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);

-- 9. Customer Orders
CREATE TABLE IF NOT EXISTS customer_orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(120) NOT NULL UNIQUE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_tier VARCHAR(64) NOT NULL DEFAULT 'Standard',
    status VARCHAR(64) NOT NULL DEFAULT 'Pending',
    priority VARCHAR(64) NOT NULL DEFAULT 'Medium',
    total_value DOUBLE PRECISION NOT NULL DEFAULT 0,
    assigned_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
    order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivery_deadline TIMESTAMPTZ,
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON customer_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_warehouse_status ON customer_orders(assigned_warehouse_id, status);

-- 10. Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
    sku VARCHAR(64) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    unit_price_available INTEGER NOT NULL DEFAULT 1,
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);

-- 11. Disruptions
CREATE TABLE IF NOT EXISTS disruptions (
    id SERIAL PRIMARY KEY,
    disruption_code VARCHAR(120) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    disruption_type VARCHAR(100) NOT NULL,
    severity VARCHAR(32) NOT NULL DEFAULT 'Medium',
    status VARCHAR(64) NOT NULL DEFAULT 'Active',
    shortage_category VARCHAR(64) NOT NULL DEFAULT 'None',
    shipment_id INTEGER REFERENCES shipments(id) ON DELETE SET NULL,
    warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
    location VARCHAR(255),
    description TEXT,
    estimated_delay_hours INTEGER NOT NULL DEFAULT 0,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    ui_route VARCHAR(255),
    ui_impact TEXT,
    ui_age VARCHAR(64),
    ui_owner VARCHAR(100),
    source_entity_type VARCHAR(64),
    source_entity_id VARCHAR(120),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);
CREATE INDEX IF NOT EXISTS idx_disruptions_status ON disruptions(status, severity);

-- 12. Disruption Affected Orders (Junction Table)
CREATE TABLE IF NOT EXISTS disruption_affected_orders (
    disruption_id INTEGER NOT NULL REFERENCES disruptions(id) ON DELETE CASCADE,
    customer_order_id INTEGER NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
    PRIMARY KEY (disruption_id, customer_order_id)
);

-- 13. Recovery Plans
CREATE TABLE IF NOT EXISTS recovery_plans (
    id SERIAL PRIMARY KEY,
    plan_code VARCHAR(120) NOT NULL UNIQUE,
    disruption_id INTEGER NOT NULL REFERENCES disruptions(id) ON DELETE CASCADE,
    customer_order_id INTEGER REFERENCES customer_orders(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    strategy_type VARCHAR(100) NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'Draft',
    sku VARCHAR(64),
    quantity INTEGER NOT NULL DEFAULT 0,
    source_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
    destination_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
    source_location VARCHAR(255),
    destination_location VARCHAR(255),
    estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    cost_estimate_verified INTEGER NOT NULL DEFAULT 0,
    estimated_delay_reduction_hours INTEGER NOT NULL DEFAULT 0,
    estimated_recovery_days DOUBLE PRECISION,
    description TEXT,
    rationale TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    approval_version INTEGER,
    created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    executed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    executed_at TIMESTAMPTZ,
    execution_idempotency_key VARCHAR(120) UNIQUE,
    execution_notes TEXT,
    execution_result_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    protected_value DOUBLE PRECISION NOT NULL DEFAULT 0,
    priority VARCHAR(64) NOT NULL DEFAULT 'Medium',
    progress DOUBLE PRECISION NOT NULL DEFAULT 0,
    due_label VARCHAR(64),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);
CREATE INDEX IF NOT EXISTS idx_recovery_status ON recovery_plans(status);

-- 14. Recovery Actions
CREATE TABLE IF NOT EXISTS recovery_actions (
    id SERIAL PRIMARY KEY,
    recovery_plan_id INTEGER NOT NULL REFERENCES recovery_plans(id) ON DELETE CASCADE,
    action_sequence INTEGER NOT NULL DEFAULT 1,
    action_type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'Pending',
    cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    assigned_to_role VARCHAR(64),
    executed_at TIMESTAMPTZ,
    result_details TEXT,
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);

-- 15. Approvals (Maker-Checker Governance)
CREATE TABLE IF NOT EXISTS approvals (
    id SERIAL PRIMARY KEY,
    recovery_plan_id INTEGER NOT NULL REFERENCES recovery_plans(id) ON DELETE CASCADE,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    required_role VARCHAR(64) NOT NULL DEFAULT 'RECOVERY_MANAGER',
    status VARCHAR(64) NOT NULL DEFAULT 'Pending',
    comments TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decision_at TIMESTAMPTZ,
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);

-- 16. Audit Logs (Append-Only)
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(120),
    details TEXT,
    ip_address VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);

-- 17. Webhook Events (Idempotent Carrier Callbacks)
CREATE TABLE IF NOT EXISTS webhook_events (
    id SERIAL PRIMARY KEY,
    event_identifier VARCHAR(120) NOT NULL UNIQUE,
    source VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload_json TEXT NOT NULL,
    processing_status VARCHAR(64) NOT NULL DEFAULT 'Received',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error_details TEXT,
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);

-- 18. Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    recipient_role VARCHAR(64),
    recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'Info',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    customer_order_id INTEGER REFERENCES customer_orders(id) ON DELETE SET NULL,
    disruption_id INTEGER REFERENCES disruptions(id) ON DELETE SET NULL,
    recovery_plan_id INTEGER REFERENCES recovery_plans(id) ON DELETE SET NULL,
    data_origin VARCHAR(32) NOT NULL DEFAULT 'operational'
);

-- 19. Stock Movements
CREATE TABLE IF NOT EXISTS stock_movements (
    id SERIAL PRIMARY KEY,
    movement_code VARCHAR(120) NOT NULL UNIQUE,
    recovery_plan_id INTEGER NOT NULL REFERENCES recovery_plans(id) ON DELETE CASCADE,
    sku VARCHAR(64) NOT NULL,
    source_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    destination_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    movement_type VARCHAR(64) NOT NULL,
    recorded_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'simulated'
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_plan ON stock_movements(recovery_plan_id);

-- 20. Simulation Runs
CREATE TABLE IF NOT EXISTS simulation_runs (
    id SERIAL PRIMARY KEY,
    simulation_code VARCHAR(120) NOT NULL UNIQUE,
    created_by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scenario_type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    parameters_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_origin VARCHAR(32) NOT NULL DEFAULT 'simulated'
);
CREATE INDEX IF NOT EXISTS idx_simulation_created ON simulation_runs(created_at DESC);

-- 21. Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    token_hash VARCHAR(120) NOT NULL UNIQUE,
    csrf_token VARCHAR(120) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Data Migration Steps

To transfer operational records from SQLite to PostgreSQL:

1. Provision a PostgreSQL instance on Neon or Supabase.
2. Execute the DDL script above to create all tables and indexes.
3. Export table rows from SQLite using JSON or CSV format.
4. Insert records using parameterized queries with foreign-key constraints enabled.
5. Reset sequences in PostgreSQL:
   ```sql
   SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
   SELECT setval('customers_id_seq', (SELECT MAX(id) FROM customers));
   SELECT setval('suppliers_id_seq', (SELECT MAX(id) FROM suppliers));
   SELECT setval('warehouses_id_seq', (SELECT MAX(id) FROM warehouses));
   SELECT setval('inventories_id_seq', (SELECT MAX(id) FROM inventories));
   SELECT setval('shipments_id_seq', (SELECT MAX(id) FROM shipments));
   SELECT setval('shipment_items_id_seq', (SELECT MAX(id) FROM shipment_items));
   SELECT setval('customer_orders_id_seq', (SELECT MAX(id) FROM customer_orders));
   SELECT setval('order_items_id_seq', (SELECT MAX(id) FROM order_items));
   SELECT setval('disruptions_id_seq', (SELECT MAX(id) FROM disruptions));
   SELECT setval('recovery_plans_id_seq', (SELECT MAX(id) FROM recovery_plans));
   SELECT setval('recovery_actions_id_seq', (SELECT MAX(id) FROM recovery_actions));
   SELECT setval('approvals_id_seq', (SELECT MAX(id) FROM approvals));
   SELECT setval('audit_logs_id_seq', (SELECT MAX(id) FROM audit_logs));
   SELECT setval('webhook_events_id_seq', (SELECT MAX(id) FROM webhook_events));
   SELECT setval('notifications_id_seq', (SELECT MAX(id) FROM notifications));
   SELECT setval('stock_movements_id_seq', (SELECT MAX(id) FROM stock_movements));
   SELECT setval('simulation_runs_id_seq', (SELECT MAX(id) FROM simulation_runs));
   SELECT setval('sessions_id_seq', (SELECT MAX(id) FROM sessions));
   ```
6. Set `DATABASE_URL` in your Vercel project environment settings.
