CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS incidents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('SEV1', 'SEV2', 'SEV3')),
  status      text NOT NULL DEFAULT 'investigating'
              CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  postmortem  jsonb
);

CREATE INDEX IF NOT EXISTS incidents_open_idx ON incidents (created_at DESC) WHERE status <> 'resolved';

CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = not attached yet. Deploys/pushes that arrive with no open incident are
  -- kept so a new incident can pull in "what changed recently".
  incident_id uuid REFERENCES incidents(id) ON DELETE CASCADE,
  source      text NOT NULL,   -- github | sentry | uptime | manual | system
  kind        text NOT NULL,   -- alert | error | deploy | note | status_change | recovery
  title       text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  author      text,
  external_id text,            -- provider's id, used to drop duplicate deliveries
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Webhook providers retry deliveries; the same external event must only land once.
CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_idx ON events (source, external_id) WHERE external_id IS NOT NULL;
-- Timeline is ordered by when things happened, not when we heard about them.
CREATE INDEX IF NOT EXISTS events_timeline_idx ON events (incident_id, occurred_at);

-- Persisted Yjs documents (collaborative notes), one row per room.
CREATE TABLE IF NOT EXISTS ydocs (
  name       text PRIMARY KEY,
  state      bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
