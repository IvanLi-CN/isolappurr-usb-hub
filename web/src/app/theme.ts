export type ThemeId = "isolapurr" | "isolapurr-dark" | "system";

export const THEME_STORAGE_KEY = "isolapurr_usb_hub.theme";

const VALID_THEMES: ThemeId[] = ["isolapurr", "isolapurr-dark", "system"];

function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" && (VALID_THEMES as string[]).includes(value)
  );
}

export function loadThemePreference(): ThemeId {
  if (typeof window === "undefined") {
    return "isolapurr";
  }

  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (!raw) {
    return "isolapurr";
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isThemeId(parsed) ? parsed : "isolapurr";
  } catch {
    return "isolapurr";
  }
}

export function saveThemePreference(theme: ThemeId): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
}

export function applyThemePreference(theme: ThemeId): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
    return;
  }
  root.setAttribute("data-theme", theme);
}

export function initThemeFromStorage(): ThemeId {
  const theme = loadThemePreference();
  applyThemePreference(theme);
  return theme;
}
