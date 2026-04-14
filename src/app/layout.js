import "./globals.css";

export const metadata = {
  title: "Alma Profile · Unified Workspace",
  description: "A polished profile and admin workspace built on a reusable visual foundation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="app-shell antialiased text-[var(--foreground)]">
        {children}
      </body>
    </html>
  );
}
