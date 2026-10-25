-- ==============================================================================
-- PostgreSQL User Provisioning Script for Kubotics
-- Target DB: kubotics (or your database name)
-- Schema: crm (and permission to create new schemas)
-- ==============================================================================

-- 1. Create the application user with a secure password
CREATE USER kubotics_app WITH PASSWORD 'your_secure_password_here';

-- 2. Grant connection and schema creation privileges on the database
GRANT CONNECT ON DATABASE kubotics TO kubotics_app;
GRANT CREATE ON DATABASE kubotics TO kubotics_app;

-- 3. Connect to the 'kubotics' database before running schema grants:
-- \c kubotics

-- 4. Grant all privileges on the existing "crm" schema
GRANT ALL ON SCHEMA crm TO kubotics_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA crm TO kubotics_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA crm TO kubotics_app;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA crm TO kubotics_app;

-- 5. Ensure future tables/sequences created in schema "crm" automatically inherit full permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT ALL ON TABLES TO kubotics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT ALL ON SEQUENCES TO kubotics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT ALL ON FUNCTIONS TO kubotics_app;

-- 6. Set search_path default so queries automatically resolve to "crm", "public"
ALTER ROLE kubotics_app SET search_path TO crm, public;
