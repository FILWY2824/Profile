/** @type {import('tailwindcss').Config} */
//
//  Constellation Dashboard
//
//  设计语言:
//    深空蓝底 + 玻璃质感 surface + 青绿主品牌 + 蓝色辅助 accent。
//    字体: Manrope 显示标题 + Inter 正文 + JetBrains Mono 等宽。
//    中文 fallback: Noto Sans SC, PingFang SC.
//    关键视觉: 大圆角 (xl/2xl), 玻璃 backdrop-blur, app-icon 风格卡片,
//             细微的 ring border 替代厚 box-shadow.
//
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: [
          "Manrope",
          "Inter",
          "Noto Sans SC",
          "PingFang SC",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          "Inter",
          "Manrope",
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
        // ── 主色 token ────────────────────────────────────────────
        // 背景层: bg-0 → bg-3, 由深到浅
        bg: {
          0: "#070B14",
          1: "#0A0E1A",
          2: "#0F1729",
          3: "#161D2F",
          4: "#1E2740",
        },
        surface: {
          DEFAULT: "#161D2F",
          hi: "#1E2740",
          glass: "rgba(22, 29, 47, 0.72)",
        },
        line: {
          DEFAULT: "rgba(148, 163, 184, 0.12)",
          strong: "rgba(148, 163, 184, 0.22)",
          faint: "rgba(148, 163, 184, 0.06)",
        },
        // 文字层级
        fg: {
          DEFAULT: "#E2E8F0",
          dim: "#94A3B8",
          mute: "#64748B",
          faint: "#475569",
        },
        // 主品牌青绿
        teal: {
          50: "#CCFBF1",
          100: "#99F6E4",
          200: "#5EEAD4",
          300: "#2DD4BF",
          400: "#14B8A6",
          500: "#0EA5B7",
          600: "#0E7490",
        },
        // 辅助蓝
        sky: {
          50: "#DBEAFE",
          100: "#BFDBFE",
          300: "#60A5FA",
          400: "#3B82F6",
          500: "#2563EB",
          600: "#1D4ED8",
        },
        // 状态色 (调整为夜空适配版)
        ok: {
          DEFAULT: "#10B981",
          soft: "rgba(16, 185, 129, 0.14)",
        },
        warn: {
          DEFAULT: "#F59E0B",
          soft: "rgba(245, 158, 11, 0.14)",
        },
        danger: {
          DEFAULT: "#F43F5E",
          soft: "rgba(244, 63, 94, 0.14)",
        },

        // ── 兼容旧 admin 代码的 alias ─────────────────────────────
        // 这样老的 badge-emerald / badge-red / badge-amber / badge-slate
        // / btn-primary / accent-600 等保留 markup 仍能渲染
        slate: {
          25: "#1E2740",
          50: "#161D2F",   // 旧 surface bg
          100: "#1E2740",
          200: "rgba(148,163,184,0.18)",
          300: "#475569",
          400: "#64748B",
          500: "#94A3B8",
          600: "#CBD5E1",
          700: "#E2E8F0",
          800: "#F1F5F9",
          900: "#FFFFFF",
          950: "#FFFFFF",
        },
        accent: {
          50:  "#CCFBF1",
          100: "#99F6E4",
          200: "#5EEAD4",
          300: "#2DD4BF",
          400: "#14B8A6",
          500: "#0EA5B7",
          600: "#2DD4BF",  // 用于旧 hover:underline 的链接色
          700: "#0E7490",
          800: "#155E75",
          900: "#164E63",
        },
        emerald: {
          50:  "rgba(16,185,129,0.14)",
          200: "rgba(16,185,129,0.32)",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        red: {
          50:  "rgba(244,63,94,0.14)",
          200: "rgba(244,63,94,0.32)",
          500: "#F43F5E",
          600: "#E11D48",
          700: "#BE123C",
        },
        amber: {
          50:  "rgba(245,158,11,0.14)",
          200: "rgba(245,158,11,0.32)",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
          800: "#92400E",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(45,212,191,0.35), 0 8px 30px -8px rgba(45,212,191,0.25)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 4px 24px -8px rgba(0,0,0,0.4)",
        pop: "0 12px 32px -8px rgba(0,0,0,0.5), 0 0 0 1px rgba(148,163,184,0.12)",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
        "3xl": "22px",
      },
      letterSpacing: {
        tight: "-0.018em",
        tighter: "-0.025em",
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
