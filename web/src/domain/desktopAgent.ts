export type DesktopAgentBootstrap = {
  token: string;
  agentBaseUrl: string;
  app: { name: string; version: string; mode: string };
};

export type DesktopAgent = {
  token: string;
  agentBaseUrl: string;
};

const LOCAL_USB_PORT_START = 51200;
const LOCAL_USB_PORT_END = 51299;

export async function tryBootstrapDesktopAgent(): Promise<DesktopAgent | null> {
  const sameOrigin = await fetchDesktopAgentBootstrap("/api/v1/bootstrap");
  if (sameOrigin) {
    return sameOrigin;
  }

  for (let port = LOCAL_USB_PORT_START; port <= LOCAL_USB_PORT_END; port += 1) {
    const agent = await fetchDesktopAgentBootstrap(
      `http://127.0.0.1:${port}/api/v1/bootstrap`,
    );
    if (agent) {
      return agent;
    }
  }

  return null;
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
  const url = path.startsWith("http")
    ? path
    : new URL(path, agent.agentBaseUrl).toString();
  return fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });
}

async function fetchDesktopAgentBootstrap(
  url: string,
): Promise<DesktopAgent | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
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
