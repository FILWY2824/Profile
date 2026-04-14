import { clsx } from "clsx";

export default function SectionHeading({
  title,
  description,
  eyebrow,
  action,
  align = "left",
  className,
}) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        align === "center" && "items-center text-center sm:items-center",
        className,
      )}
    >
      <div className="space-y-3">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <div className="space-y-2">
          <h2 className="text-balance text-[var(--foreground)]">{title}</h2>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-[var(--foreground-muted)] sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
