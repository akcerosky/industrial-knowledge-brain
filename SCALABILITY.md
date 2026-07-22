# Scalability

Honest notes on where this stands and what real scale would need. Not a
sales pitch.

## Current state

As of this pass, the app runs as bare processes directly on one Mac:
uvicorn on 127.0.0.1:8000, Vite on 4173/5173, Postgres 17 + pgvector on
5432, and Neo4j on 7687/7474, all installed via Homebrew, none
containerized, no auth. This commit adds Dockerfiles and a
`docker-compose.yml` (see below) but they are **unbuilt and untested** --
there is no `docker` binary on this machine, so nothing here has actually
been built or run in a container.

The good news, verified by reading the code rather than assumed:

- `backend/retrieval/router.py`'s `_default_graph_store()` already prefers
  a real `Neo4jGraphStore` whenever `NEO4J_URI` is set and reachable at
  startup, and only falls back to the in-memory `InMemoryGraphStore` if the
  env var is missing or the driver can't connect. Same idea for vectors:
  `HybridRetrievalRouter.__init__` picks `PgVectorStore()` over
  `InMemoryVectorStore()` whenever `DATABASE_URL` is set.
- `backend/retrieval/index.py`'s `EmbeddingModel` picks the real Gemini
  embedding backend (`google-genai`, model output dim `EMBEDDING_DIMENSION`)
  whenever `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is present, and only
  falls back to a deterministic hash-bucket embedding when no key is
  configured or a call fails at runtime (network/quota errors degrade
  per-call, not permanently).

So: with `NEO4J_URI`, `DATABASE_URL`, and `GEMINI_API_KEY` configured (which
they are in this environment's `backend/.env`), the app is already running
against real external graph/vector/embedding backends, not in-memory
stand-ins. That's the load-bearing precondition for most of what follows --
you can't add workers or a load balancer in front of state that lives
inside a single process's memory, and this app has (mostly) already moved
that state out.

## What's still missing for real scale

1. **Connection pooling.** `_default_graph_store()` opens a single
   `neo4j.GraphDatabase.driver` at process startup and reuses it -- the
   neo4j Python driver pools internally, so that part is reasonable, but
   there's no explicit pool sizing/lifecycle tuning (`max_connection_pool_size`,
   connection acquisition timeout, retry policy) for production load.
   `PgVectorStore` (via `psycopg`) is worse: as written it's a
   per-call/per-request connection pattern with no pool at all. Under
   concurrent load this will exhaust Postgres's connection limit fast. This
   needs a real pool -- `psycopg_pool.ConnectionPool` on the Postgres side,
   explicit pool config on the Neo4j driver -- shared across requests
   within a worker process.

2. **Multiple workers behind a load balancer.** Because graph/vector state
   now lives in Neo4j and Postgres rather than in-process, it's finally
   *feasible* to run more than one uvicorn worker (`--workers N`, or
   multiple container replicas) behind a load balancer/reverse proxy,
   instead of the current single dev process. This wasn't safely possible
   before those stores moved external -- multiple workers each holding
   their own `InMemoryGraphStore`/`InMemoryVectorStore` would silently
   diverge. It still isn't wired up here (the Dockerfile's `CMD` runs a
   single uvicorn process); that's the next step, not something this pass
   implements.

3. **Real authn/authz.** `backend/api/auth.py`'s `require_api_key` is a
   deliberately minimal starting point: one shared secret in `X-API-Key`,
   no-op when `API_KEY` is unset (which it currently is in this
   environment -- confirmed via `env | grep API_KEY` returning nothing).
   It has no per-user identity, no scopes/roles, no key rotation, and the
   key itself would need to move to a real secrets manager rather than a
   compose env var for anything beyond a hackathon demo.

4. **Rate limiting for Gemini calls.** Nothing currently limits the rate at
   which `EmbeddingModel._embed_with_gemini` (or the LLM calls elsewhere in
   `backend/llm/`) hits the Gemini API. At any real concurrency this will
   hit quota/rate limits, and there's no backoff/queue/token-bucket in
   front of it today -- the only existing resilience is the per-call
   fallback to the hash embedding on exception, which masks failures rather
   than smoothing load.

5. **`IngestionJobManager` is in-memory and will not survive multiple
   workers or a restart.** `backend/ingestion/jobs.py`'s
   `IngestionJobManager` stores all job/stage state in a plain
   `dict[str, IngestionJob]` on the instance (`self._jobs`), with an
   explicit comment that it's "an in-memory job tracker for the demo
   upload pipeline." Concretely, that means: (a) a process restart loses
   every in-flight and historical job; (b) running more than one uvicorn
   worker/replica (see #2) breaks it outright, since a client polling
   `GET /api/ingest/upload/{job_id}` could land on a different worker than
   the one that created the job and get a 404 for a job that "exists." This
   needs to move to shared external state -- Redis (simple, fits the
   existing key/stage-status shape well) or a Postgres table (reuses the
   database already in the stack) -- before this app can safely run behind
   more than one worker process.

## Summary

The data layer (graph + vectors + embeddings) already made the jump to
external, shareable state, which is the hard part and the main
scalability win in this pass. The application layer hasn't caught up yet:
job tracking is still process-local, there's no connection pooling, no
rate limiting, no load balancer, and auth is a single shared-secret
placeholder. The Dockerfiles and compose file in this pass make
containerizing straightforward, but they've only been read-reviewed, not
built or run, since Docker isn't installed on this machine.
