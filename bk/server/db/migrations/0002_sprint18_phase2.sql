-- Sprint 18 Phase 2 migration: welcome ack flag on auth_users
ALTER TABLE auth_users ADD COLUMN welcome_ack INTEGER NOT NULL DEFAULT 0;
