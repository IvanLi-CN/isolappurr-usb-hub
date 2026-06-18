import { useLocation } from "react-router";

import { ErrorState } from "../ui/errors/ErrorState";

export function NotFoundPage() {
  const location = useLocation();

  return (
    <ErrorState
      code="404"
      title="Page not found"
      description="The page you opened is not available in this workspace. Return to a known screen to keep working."
      context={
        <div className="flex min-w-0 flex-col gap-1 overflow-hidden sm:flex-row sm:items-start sm:gap-2">
          <span className="shrink-0 text-[var(--text)]">Missing path:</span>
          <code className="block min-w-0 max-w-full overflow-hidden font-mono text-[12px] break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
            {location.pathname}
            {location.search}
            {location.hash}
          </code>
        </div>
      }
      pathTestId="not-found-path"
      testId="not-found"
      fullPage
      actions={[
        { label: "Dashboard", to: "/", variant: "primary" },
        { label: "About", to: "/about", variant: "secondary" },
      ]}
    />
  );
}
