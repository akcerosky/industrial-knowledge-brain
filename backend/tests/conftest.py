import os

import dotenv

# Module-level singletons in backend/api/routes.py (e.g. retrieval_router) call
# get_llm_client() exactly once, at import time — long before any per-test
# fixture gets a chance to run. A fixture-scoped env var would be too late to
# stop that first call from baking a live Gemini client into those
# singletons, which would make the whole test session issue real, slow,
# non-deterministic, billed calls to the Gemini API. Setting this at module
# level fixes that: conftest.py is always imported before test modules (and
# before backend.main), so this is in place before any import happens.
os.environ["DISABLE_LLM"] = "1"

# backend.main also calls load_dotenv() at import time, which would otherwise
# overwrite the DISABLE_LLM value above from backend/.env. Neutralize it too.
dotenv.load_dotenv = lambda *args, **kwargs: False
