import type { ReactNode } from "react";

function buildInfo(): { sha: string; date: string } {
  const rawSha =
    (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? "dev";
  const sha = rawSha === "dev" ? rawSha : rawSha.slice(0, 7);
  const date = (import.meta.env.VITE_BUILD_DATE as string | undefined) ?? "";
  return { sha, date };
}

export function AppLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const { sha, date } = buildInfo();

  return (
    <div className="flex h-full flex-col">
      <header className="navbar bg-base-200">
        <div className="flex-1">
          <a className="btn btn-ghost text-xl" href={import.meta.env.BASE_URL}>
            Isolapurr USB Hub
          </a>
        </div>
        <div className="flex-none">
          <div className="text-right text-xs opacity-70">
            <div>build: {sha}</div>
            {date ? <div>{date}</div> : null}
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="border-base-300 bg-base-200/50 lg:w-96 lg:border-r">
          {sidebar}
        </aside>
        <main className="min-h-0 flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
