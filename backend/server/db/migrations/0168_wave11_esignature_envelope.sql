-- 0168_wave11_esignature_envelope.sql
--
-- WAVE 11 / EN-9 — third-party e-signature execution for LPA and subscription
-- documents.
--
-- WHY A NEW TABLE SET (absence verified at source, not quoted from the spec):
--   grep -rlniE 'docusign|signature_request|adobe_sign|esign' server/ client/src
--     -> the only hits are the reserved notification type
--        `spv.subscription_countersigned` (server/notificationsStore.ts:57,99)
--        and the composer that lists it (client/src/pages/admin/
--        NotificationComposer.tsx:65). Both are SLOTS WITH NO PRODUCER.
--   The real near-neighbour is the typed-name click-through attestation at
--   server/lib/partnerSelfServiceRoutes.ts POST /api/partner/me/agreement, which
--   hashes name|version|timestamp into contacts.partner_agreement_signature_hash.
--   That is a ONE-PARTY, ONE-DOCUMENT, NO-COUNTERSIGNATURE flow with no envelope
--   identity, so it cannot represent an LPA executed by an LP and countersigned
--   by the GP. It IS, however, a legitimate signing METHOD, and this schema keeps
--   it as the default provider rather than replacing it (trap #2: prefer wiring).
--
-- DESIGN NOTES
--   * Envelopes are PERSONA-AGNOSTIC (subject_kind/subject_id), the same shape
--     EN-6 used, so an LPA for an SPV, a subscription doc for a Collective member
--     and a partner agreement all fit without a new table each.
--   * The document is referenced by the dataroom BYTE SEAM: (document_kind,
--     document_ref) plus a `document_sha256` captured at send time. The bytes are
--     NOT copied here. If the underlying file is replaced, the recorded hash no
--     longer matches and the envelope is provably against a different document.
--   * `provider` is DB-configured (platform_config key
--     `collective.esignature.provider`, seeded by the installer, default
--     "internal_attestation"). An EXTERNAL provider FAILS CLOSED: without
--     credentials the send is refused, never silently downgraded to a typed name.
--   * esign_event is append-only, DB-enforced.
--   * NO money columns: nothing here charges anything.

CREATE TABLE IF NOT EXISTS esign_envelope (
  id                  TEXT PRIMARY KEY NOT NULL,
  -- Persona-agnostic subject, as EN-6. 'partner' | 'collective_member' | 'spv' | 'company'
  subject_kind        TEXT NOT NULL,
  subject_id          TEXT NOT NULL,
  -- 'lpa' | 'subscription_agreement' | 'partner_agreement' | 'side_letter' | 'other'
  document_kind       TEXT NOT NULL,
  -- Dataroom byte seam: the file/agreement identity, NOT the bytes.
  document_ref        TEXT NOT NULL,
  document_title      TEXT NOT NULL,
  document_sha256     TEXT,
  -- Resolved from platform_config at send time and FROZEN on the row, so an
  -- envelope always says which method actually executed it.
  provider            TEXT NOT NULL,
  provider_envelope_id TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','partially_signed','completed','declined','voided','expired','failed')),
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  sent_at             TEXT,
  completed_at        TEXT,
  voided_at           TEXT,
  expires_at          TEXT,
  -- Set only when every required recipient has signed; the completion hash chains
  -- the recipient signature hashes in signing order.
  completion_hash     TEXT,
  last_error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_w11_esign_subject
  ON esign_envelope(subject_kind, subject_id, created_at);
CREATE INDEX IF NOT EXISTS idx_w11_esign_status
  ON esign_envelope(status, created_at);
CREATE INDEX IF NOT EXISTS idx_w11_esign_docref
  ON esign_envelope(document_kind, document_ref);
-- One provider envelope id maps to at most one local envelope, so a replayed
-- provider callback cannot fan out onto two records.
CREATE UNIQUE INDEX IF NOT EXISTS uq_w11_esign_provider_envelope
  ON esign_envelope(provider_envelope_id)
  WHERE provider_envelope_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS esign_recipient (
  id                  TEXT PRIMARY KEY NOT NULL,
  envelope_id         TEXT NOT NULL REFERENCES esign_envelope(id),
  -- 'signer' | 'countersigner' | 'cc'
  role                TEXT NOT NULL DEFAULT 'signer'
                        CHECK (role IN ('signer','countersigner','cc')),
  -- Signing order: 1 signs before 2. Countersignature is just a later order.
  signing_order       INTEGER NOT NULL DEFAULT 1 CHECK (signing_order > 0),
  party_kind          TEXT NOT NULL,
  party_id            TEXT,
  full_name           TEXT NOT NULL,
  email               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sent','signed','declined','bounced')),
  -- The typed name AS ENTERED is retained (it is the legal mark for the internal
  -- attestation provider); the hash below is what binds it to the document.
  signed_name         TEXT,
  signature_hash      TEXT,
  signed_at           TEXT,
  declined_reason     TEXT,
  -- Evidence for a disputed signature.
  ip_address          TEXT,
  user_agent          TEXT,
  access_token_hash   TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (envelope_id, signing_order, email)
);

CREATE INDEX IF NOT EXISTS idx_w11_esign_recip_env
  ON esign_recipient(envelope_id, signing_order);
CREATE INDEX IF NOT EXISTS idx_w11_esign_recip_status
  ON esign_recipient(status);

CREATE TABLE IF NOT EXISTS esign_event (
  id                  TEXT PRIMARY KEY NOT NULL,
  envelope_id         TEXT NOT NULL REFERENCES esign_envelope(id),
  recipient_id        TEXT,
  event_kind          TEXT NOT NULL,
  from_status         TEXT,
  to_status           TEXT,
  actor               TEXT,
  detail_json         TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_w11_esign_event_env
  ON esign_event(envelope_id, created_at);

-- Append-only audit, enforced by the DB and not by convention. Same pattern as
-- 0167's partner_subscription_event triggers.
CREATE TRIGGER IF NOT EXISTS trg_w11_ese_no_update
  BEFORE UPDATE ON esign_event
  BEGIN SELECT RAISE(ABORT, 'ESIGN_EVENT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_w11_ese_no_delete
  BEFORE DELETE ON esign_event
  BEGIN SELECT RAISE(ABORT, 'ESIGN_EVENT_IMMUTABLE'); END;

-- A completed envelope is EXECUTED. Its document identity, provider and
-- completion hash are frozen: re-pointing an executed LPA at another file, or
-- re-opening it for another signature, would invalidate the execution record.
CREATE TRIGGER IF NOT EXISTS trg_w11_esign_completed_frozen
  BEFORE UPDATE ON esign_envelope
  WHEN OLD.status = 'completed'
   AND (NEW.document_ref     <> OLD.document_ref
     OR NEW.document_kind    <> OLD.document_kind
     OR NEW.provider         <> OLD.provider
     OR IFNULL(NEW.document_sha256,'') <> IFNULL(OLD.document_sha256,'')
     OR IFNULL(NEW.completion_hash,'') <> IFNULL(OLD.completion_hash,'')
     OR NEW.status <> 'completed')
  BEGIN SELECT RAISE(ABORT, 'ESIGN_ENVELOPE_COMPLETED_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_w11_esign_no_delete
  BEFORE DELETE ON esign_envelope
  BEGIN SELECT RAISE(ABORT, 'ESIGN_ENVELOPE_NO_DELETE'); END;

-- A recorded signature is final. Voiding an envelope does not rewrite who signed
-- it; it is a status change on the envelope plus an event.
CREATE TRIGGER IF NOT EXISTS trg_w11_esign_signature_frozen
  BEFORE UPDATE ON esign_recipient
  WHEN OLD.status = 'signed'
   AND (IFNULL(NEW.signature_hash,'') <> IFNULL(OLD.signature_hash,'')
     OR IFNULL(NEW.signed_name,'')    <> IFNULL(OLD.signed_name,'')
     OR IFNULL(NEW.signed_at,'')      <> IFNULL(OLD.signed_at,'')
     OR NEW.status <> 'signed')
  BEGIN SELECT RAISE(ABORT, 'ESIGN_SIGNATURE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_w11_esign_recipient_no_delete
  BEFORE DELETE ON esign_recipient
  BEGIN SELECT RAISE(ABORT, 'ESIGN_RECIPIENT_NO_DELETE'); END;
