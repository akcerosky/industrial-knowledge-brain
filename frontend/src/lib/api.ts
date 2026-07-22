type ImportMetaWithEnv = ImportMeta & {
  env?: Record<string, string | undefined>;
};

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getConfiguredApiBase() {
  const metaEnv = (import.meta as ImportMetaWithEnv).env ?? {};
  const envBase = metaEnv.VITE_API_BASE_URL;
  if (typeof envBase === "string" && envBase.trim().length > 0) {
    return trimTrailingSlash(envBase.trim());
  }

  return "";
}

function getLocalBackendBase() {
  const metaEnv = (import.meta as ImportMetaWithEnv).env ?? {};
  if (typeof window !== "undefined") {
    const { hostname, protocol, port } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const backendPort = metaEnv.VITE_API_PORT || "8000";
      if (port !== backendPort) {
        return `${protocol}//${hostname}:${backendPort}`;
      }
    }
  }

  return "";
}

export function apiUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getConfiguredApiBase();
  return base ? `${base}${normalized}` : normalized;
}

export async function apiFetch(path: string, init?: RequestInit) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const configuredBase = getConfiguredApiBase();
  if (configuredBase) {
    return fetch(`${configuredBase}${normalized}`, init);
  }

  const attempts = [normalized];
  const localBase = getLocalBackendBase();
  if (localBase) {
    attempts.push(`${localBase}${normalized}`);
  }

  let lastError: unknown;
  for (const target of attempts) {
    try {
      return await fetch(target, init);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to reach the API.");
}
