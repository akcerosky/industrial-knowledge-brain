-- Runs automatically on first container startup because the
-- pgvector/pgvector image (like the upstream postgres image it's built on)
-- executes any *.sql / *.sh files found in /docker-entrypoint-initdb.d/
-- against the freshly-created database, in filename order, exactly once
-- (only when the data directory is empty).
CREATE EXTENSION IF NOT EXISTS vector;
