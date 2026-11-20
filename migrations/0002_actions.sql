-- Smarter reminders: skip a reminder you've already done today, and one-off snoozes.
ALTER TABLE rems ADD COLUMN once INTEGER NOT NULL DEFAULT 0;       -- 1 = one-off snooze row (key is '~' + reminder key)
ALTER TABLE rems ADD COLUMN skip_until INTEGER NOT NULL DEFAULT 0; -- once=0: don't send before this epoch ms (done today); once=1: when to send
CREATE INDEX IF NOT EXISTS rems_once ON rems(once, skip_until);
