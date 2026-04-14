import { clsx } from "clsx";

export default function PageShell({
  children,
  className,
  width = "default",
  as: Component = "section",
  padded = true,
}) {
  const widthClass =
    width === "wide"
      ? "max-w-7xl"
      : width === "narrow"
        ? "max-w-4xl"
        : "max-w-6xl";

  return (
    <Component
      className={clsx(
        "page-container w-full",
        widthClass,
        padded && "py-8 sm:py-10 lg:py-12",
        className,
      )}
    >
      {children}
    </Component>
  );
}
