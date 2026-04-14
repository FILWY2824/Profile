import { clsx } from "clsx";

export default function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}) {
  return (
    <div
      className={clsx(
        "surface-panel flex flex-col items-center justify-center gap-4 px-6 py-12 text-center sm:px-10",
        className,
      )}
    >
      {icon ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-white/5 text-[var(--accent)]">
          {icon}
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-[var(--foreground)]">{title}</h3>
        {description ? (
          <p className="max-w-md text-sm leading-6 text-[var(--foreground-muted)] sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
