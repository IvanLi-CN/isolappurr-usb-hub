import { useMemo } from "react";
import {
  Link,
  type LinkProps,
  NavLink,
  type NavLinkProps,
  type To,
  useNavigate,
} from "react-router";
import { useDemoMode } from "./demo-mode";

function appendSearch(to: To, search: string): To {
  if (!search) {
    return to;
  }
  if (typeof to === "string") {
    const url = new URL(to, "https://demo.local");
    if (url.search) {
      return to;
    }
    url.search = search;
    return `${url.pathname}${url.search}${url.hash}`;
  }
  if (to.search) {
    return to;
  }
  return {
    ...to,
    search,
  };
}

export function useDemoAwareTo() {
  const { enabled } = useDemoMode();
  const search = enabled ? "?demo=true" : "";
  return useMemo(
    () => ({
      enabled,
      search,
      to: (to: To) => appendSearch(to, search),
    }),
    [enabled, search],
  );
}

export function useDemoNavigate() {
  const navigate = useNavigate();
  const { to } = useDemoAwareTo();
  return (target: To, options?: { replace?: boolean; state?: unknown }) =>
    navigate(to(target), options);
}

export function DemoLink(props: LinkProps) {
  const { to } = useDemoAwareTo();
  return <Link {...props} to={to(props.to)} />;
}

export function DemoNavLink(props: NavLinkProps) {
  const { to } = useDemoAwareTo();
  return <NavLink {...props} to={to(props.to)} />;
}
