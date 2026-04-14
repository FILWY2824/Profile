import { clsx } from "clsx";

export default function SurfaceCard({
  children,
  className,
  tone = "default",
  padding = "md",
  as: Component = "div",
}) {
  const toneClass =
    tone === "strong"
      ? "surface-panel-strong"
      : tone === "soft"
        ? "border border-[var(--border)] bg-[var(--surface-soft)] shadow-[var(--shadow-sm)] backdrop-blur-md"
        : "surface-panel";

  const paddingClass =
    padding === "lg"
      ? "p-8 sm:p-10"
      : padding === "sm"
        ? "p-4 sm:p-5"
        : "p-6 sm:p-7";

  return <Component className={clsx(toneClass, paddingClass, className)}>{children}</Component>;
}
