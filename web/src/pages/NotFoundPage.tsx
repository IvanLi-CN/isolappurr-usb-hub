import { useLocation } from "react-router";

import { ErrorState } from "../ui/errors/ErrorState";

export function NotFoundPage() {
  const location = useLocation();

  return (
    <ErrorState
      code="404"
      title="Page not found"
      description="This route does not exist in the IsolaPurr control console. Use a known entry point to return to the current workspace."
      context={
        <span data-testid="not-found-path">
          Missing path: {location.pathname}
          {location.search}
          {location.hash}
        </span>
      }
      eyebrow="Route fallback"
      testId="not-found"
      fullPage
      actions={[
        { label: "Back to Dashboard", to: "/", variant: "primary" },
        { label: "About", to: "/about", variant: "secondary" },
      ]}
    />
  );
}
