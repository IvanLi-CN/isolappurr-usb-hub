import { useTheme } from "../app/theme-ui";

function buildInfo(): { sha: string; date: string } {
  const rawSha =
    (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? "dev";
  const sha = rawSha === "dev" ? rawSha : rawSha.slice(0, 7);
  const date = (import.meta.env.VITE_BUILD_DATE as string | undefined) ?? "";
  return { sha, date };
}

function envLink(key: string): string | null {
  const value = (import.meta.env[key] as string | undefined) ?? "";
  return value.trim() ? value.trim() : null;
}

export function AboutPage() {
  const { theme } = useTheme();
  const { sha, date } = buildInfo();

  const repoUrl = envLink("VITE_REPO_URL");
  const docsUrl = envLink("VITE_DOCS_URL");
  const issuesUrl = envLink("VITE_ISSUES_URL");

  return (
    <div className="flex flex-col gap-6" data-testid="about">
      <div>
        <div className="text-[24px] font-bold">About</div>
        <div className="mt-2 text-[14px] font-medium text-[var(--muted)]">
          Build info, links, and quick usage
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="iso-card h-[176px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="text-[16px] font-bold leading-5">Build</div>

          <div className="mt-3 flex flex-col gap-[10px] leading-4">
            <div className="flex items-center">
              <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
                build
              </div>
              <div className="font-mono text-[12px] font-semibold">{sha}</div>
            </div>
            <div className="flex items-center">
              <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
                date
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {date || "unknown"}
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
                theme
              </div>
              <div className="text-[12px] font-semibold">
                isolapurr / isolapurr-dark / system ({theme})
              </div>
            </div>
          </div>
        </div>

        <div className="iso-card h-[176px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="text-[16px] font-bold leading-5">
            Links & defaults
          </div>

          <div className="mt-1 text-[12px] font-semibold leading-4 text-[var(--muted)]">
            Links
          </div>

          <div className="mt-1 flex items-center gap-2">
            <a
              className={[
                "flex h-9 w-[120px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[12px] font-bold text-[var(--text)]",
                repoUrl ? "" : "pointer-events-none opacity-40",
              ].join(" ")}
              href={repoUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              Repo
            </a>
            <a
              className={[
                "flex h-9 w-[120px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[12px] font-bold text-[var(--text)]",
                docsUrl ? "" : "pointer-events-none opacity-40",
              ].join(" ")}
              href={docsUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
            <a
              className={[
                "flex h-9 w-[120px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[12px] font-bold text-[var(--text)]",
                issuesUrl ? "" : "pointer-events-none opacity-40",
              ].join(" ")}
              href={issuesUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              Issues
            </a>
          </div>

          <div className="mt-0 text-[12px] font-semibold leading-4 text-[var(--muted)]">
            Defaults
          </div>
          <div className="grid grid-cols-[240px_1fr] gap-x-6 gap-y-0 leading-4">
            <div className="text-[12px] font-semibold">Units: V / A / W</div>
            <div className="text-[12px] font-semibold">Power off: confirm</div>
            <div className="text-[12px] font-semibold">
              Report: 1s • Offline: 10s
            </div>
            <div className="text-[12px] font-semibold">Replug: one-shot</div>
          </div>
        </div>
      </div>

      <div className="iso-card h-[288px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="text-[16px] font-bold">Quick usage</div>

        <div className="mt-4 text-[14px] font-medium">
          1) Add a device: baseUrl examples
        </div>
        <div className="mt-[10px] space-y-[6px] font-mono text-[12px] font-semibold text-[var(--muted)] leading-4">
          <div>http://&lt;hostname&gt;.local</div>
          <div>http://192.168.1.42</div>
        </div>

        <div className="mt-6 text-[14px] font-medium">
          2) Dashboard shows V/A/W and actions
        </div>
        <div className="mt-4 text-[14px] font-medium">
          3) Power off requires a popover confirmation
        </div>

        <div className="mt-8 flex items-center leading-4">
          <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
            Language
          </div>
          <div className="text-[12px] font-semibold">
            Default English; i18n later
          </div>
        </div>
      </div>
    </div>
  );
}
