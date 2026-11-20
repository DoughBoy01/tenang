-- Web Push subscriptions. No health data is stored: only the push endpoint/keys and reminder times + text.
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  p256dh   TEXT NOT NULL,
  auth     TEXT NOT NULL,
  updated  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rems (
  endpoint TEXT NOT NULL,
  k        TEXT NOT NULL,
  utc_min  INTEGER NOT NULL, -- minute of the UTC day (0-1439) the reminder fires
  payload  TEXT NOT NULL,    -- JSON {title, body, url, k}
  PRIMARY KEY (endpoint, k)
);
CREATE INDEX IF NOT EXISTS rems_utc_min ON rems(utc_min);
