/** @type {import('tailwindcss').Config} */
//
//  Hub · 柔绿玻璃主题 (Soft Mint Glass)
//
//  设计语言:
//    极浅薄荷底 + 4 层 mesh 渐变 (薄荷 / 嫩绿 / 浅青 / 暖米) + 半透明白色玻璃 surface
//    主品牌 emerald #10B981, 强调 teal #14B8A6, 文字深绿色调墨色
//    字体: Bricolage Grotesque (display) + Plus Jakarta Sans (sans) + Noto Sans SC (CJK)
//
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: [
          "Bricolage Grotesque",
          "Plus Jakarta Sans",
          "Manrope",
          "Inter",
          "Noto Sans SC",
          "PingFang SC",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          "Plus Jakarta Sans",
          "Inter",
          "Noto Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // ── bg 层 (浅色玻璃下表示半透明面, 这里给出 fallback 实色) ─
        bg: {
          0: "#F4FBF6",
          1: "#F4FBF6",
          2: "#FFFFFF",
          3: "#FFFFFF",
          4: "#FFFFFF",
        },
        surface: {
          DEFAULT: "rgba(255, 255, 255, 0.65)",
          hi:      "rgba(255, 255, 255, 0.85)",
          glass:   "rgba(255, 255, 255, 0.55)",
        },
        line: {
          DEFAULT: "rgba(15, 36, 25, 0.08)",
          strong:  "rgba(15, 36, 25, 0.16)",
          faint:   "rgba(15, 36, 25, 0.04)",
        },
        // 文字层级 (深绿色调墨色)
        fg: {
          DEFAULT: "#0F2419",
          dim:     "#2D4A3E",
          mute:    "#5A7468",
          faint:   "#8FA89A",
        },
        // 主品牌 emerald — keep "teal" namespace for backward compat
        teal: {
          50:  "#ECFDF5",
          100: "#D1FAE5",
          200: "#A7F3D0",
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        // 辅助色 cyan
        sky: {
          50:  "#ECFEFF",
          100: "#CFFAFE",
          300: "#67E8F9",
          400: "#06B6D4",
          500: "#0891B2",
          600: "#0E7490",
        },
        ok: {
          DEFAULT: "#059669",
          soft: "rgba(16, 185, 129, 0.14)",
        },
        warn: {
          DEFAULT: "#D97706",
          soft: "rgba(217, 119, 6, 0.14)",
        },
        danger: {
          DEFAULT: "#DC2626",
          soft: "rgba(220, 38, 38, 0.14)",
        },

        // ── 兼容旧 admin 代码的 alias ─────────────────────────────
        slate: {
          25: "#FFFFFF",
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "rgba(15, 36, 25, 0.10)",
          300: "#8FA89A",
          400: "#5A7468",
          500: "#2D4A3E",
          600: "#0F2419",
          700: "#0F2419",
          800: "#0F2419",
          900: "#0F2419",
          950: "#0F2419",
        },
        accent: {
          50:  "#ECFDF5",
          100: "#D1FAE5",
          200: "#A7F3D0",
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
          800: "#065F46",
          900: "#064E3B",
        },
        emerald: {
          50:  "rgba(16,185,129,0.12)",
          200: "rgba(16,185,129,0.30)",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        red: {
          50:  "rgba(220,38,38,0.10)",
          200: "rgba(220,38,38,0.28)",
          500: "#DC2626",
          600: "#B91C1C",
          700: "#991B1B",
        },
        amber: {
          50:  "rgba(245,158,11,0.14)",
          200: "rgba(245,158,11,0.32)",
          500: "#D97706",
          600: "#B45309",
          700: "#92400E",
          800: "#78350F",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(16,185,129,0.35), 0 8px 30px -8px rgba(16,185,129,0.30)",
        card: "0 1px 0 0 rgba(255,255,255,0.85) inset, 0 12px 36px -16px rgba(15, 36, 25, 0.10)",
        pop:  "0 1px 0 rgba(255,255,255,0.85) inset, 0 12px 32px -8px rgba(15, 36, 25, 0.18)",
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
        "3xl": "24px",
      },
      letterSpacing: {
        tight:   "-0.02em",
        tighter: "-0.03em",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "fade-in": "fade-in 0.35s ease-out both",
        "rise":    "rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "shine":   "shine 2.4s ease-in-out infinite",
      },
      keyframes: {
        "fade-up": {
          "0%":   { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "fade-in": {
          "0%":   { opacity: 0 },
          "100%": { opacity: 1 },
        },
        "rise": {
          "0%":   { opacity: 0, transform: "translateY(14px) scale(0.985)" },
          "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
        },
        "shine": {
          "0%, 100%": { opacity: 0.5, transform: "scale(1)" },
          "50%":      { opacity: 1,   transform: "scale(1.06)" },
        },
      },
    },
  },
  plugins: [],
};
