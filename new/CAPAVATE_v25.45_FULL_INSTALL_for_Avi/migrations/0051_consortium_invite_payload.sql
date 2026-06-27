-- Migration 0051: consortium_applications — invite payload column
-- v23.4.1 hotfix Task B
--
-- Adds `invite_payload_json` TEXT column to consortium_applications.
-- Stores: { inviteLink, inviteEmailStatus, inviteEmailError, sentAt }
-- after an application is approved and a redeem token is minted.
--
-- Idempotent: uses IF NOT EXISTS / column-existence guard via
-- a CREATE TABLE + ALTER dance that SQLite supports safely.
-- SQLite does not support ALTER TABLE ADD COLUMN IF NOT EXISTS,
-- so we use a soft guard: the migrate runner already skips statements
-- that fail with "duplicate column name" (see migrate.ts skipIdempotentErrors).

ALTER TABLE consortium_applications ADD COLUMN invite_payload_json TEXT;
