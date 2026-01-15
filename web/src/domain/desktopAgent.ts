export type DesktopAgentBootstrap = {
  token: string;
  agentBaseUrl: string;
  app: { name: string; version: string; mode: string };
};

export type DesktopAgent = {
  token: string;
  agentBaseUrl: string;
};

export async function tryBootstrapDesktopAgent(): Promise<DesktopAgent | null> {
  try {
    const res = await fetch("/api/v1/bootstrap", { cache: "no-store" });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as unknown;
    if (!json || typeof json !== "object") {
      return null;
    }
    const obj = json as Record<string, unknown>;
    const token = typeof obj.token === "string" ? obj.token : null;
    const agentBaseUrl =
      typeof obj.agentBaseUrl === "string" ? obj.agentBaseUrl : null;
    if (!token || !agentBaseUrl) {
      return null;
    }
    return { token, agentBaseUrl };
  } catch {
    return null;
  }
}

export async function agentFetch(
  agent: DesktopAgent,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${agent.token}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });
}
