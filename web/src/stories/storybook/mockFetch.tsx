import type { Decorator } from "@storybook/react";
import { type ReactNode, useEffect, useMemo } from "react";

export type MockFetch = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  original: typeof fetch,
) => ReturnType<typeof fetch>;

function toUrl(input: Parameters<MockFetch>[0]): URL | null {
  if (typeof input === "string") {
    return new URL(input, window.location.origin);
  }
  if (input instanceof URL) {
    return input;
  }
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return null;
}

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

export function notFound(): Response {
  return new Response("", { status: 404 });
}

export function mockFetchDecorator(mock: MockFetch): Decorator {
  function MockFetchScope({ children }: { children: ReactNode }) {
    const original = useMemo(() => globalThis.fetch, []);
    globalThis.fetch = ((input, init) => {
      const url = toUrl(input);
      if (!url) {
        return original(input, init);
      }
      return mock(input, init, original);
    }) as typeof fetch;

    useEffect(() => {
      return () => {
        globalThis.fetch = original;
      };
    }, [original]);

    return children;
  }

  return (Story) => {
    return (
      <MockFetchScope>
        <Story />
      </MockFetchScope>
    );
  };
}
