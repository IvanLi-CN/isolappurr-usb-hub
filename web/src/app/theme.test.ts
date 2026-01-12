import { describe, expect, test } from "bun:test";

import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "./theme";

describe("theme preference", () => {
  test("defaults to system when missing/invalid", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    } as unknown as Window;

    store.set(THEME_STORAGE_KEY, "not-json");
    expect(loadThemePreference()).toBe("isolapurr");

    store.set(THEME_STORAGE_KEY, JSON.stringify("bad"));
    expect(loadThemePreference()).toBe("isolapurr");
  });

  test("round-trips theme id as JSON string", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    } as unknown as Window;

    const value: ThemeId = "isolapurr-dark";
    saveThemePreference(value);
    expect(store.get(THEME_STORAGE_KEY)).toBe(JSON.stringify(value));
    expect(loadThemePreference()).toBe(value);
  });

  test("applies theme via data-theme (or removes it for system)", () => {
    const attrs = new Map<string, string>();
    (globalThis as unknown as { document: unknown }).document = {
      documentElement: {
        setAttribute: (k: string, v: string) => void attrs.set(k, v),
        removeAttribute: (k: string) => void attrs.delete(k),
      },
    } as unknown as Document;

    applyThemePreference("isolapurr");
    expect(attrs.get("data-theme")).toBe("isolapurr");

    applyThemePreference("system");
    expect(attrs.has("data-theme")).toBe(false);
  });
});
