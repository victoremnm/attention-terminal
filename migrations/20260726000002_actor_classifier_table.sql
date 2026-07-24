-- +goose Up
CREATE TABLE IF NOT EXISTS curated.gh_actor_classifier (
  actor_login String,
  is_bot UInt8 DEFAULT 0,
  confidence Float32 DEFAULT 1.0,
  reason String DEFAULT 'heuristic',
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PRIMARY KEY (actor_login)
ORDER BY (actor_login);

-- +goose Down
DROP TABLE IF EXISTS curated.gh_actor_classifier;
