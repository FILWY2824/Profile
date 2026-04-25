/** @type {import('tailwindcss').Config} */
//
// 栖枢档案 · Editorial Archive
//
// 设计语言:
//   羊皮纸底色 + 墨黑文字 + 朱砂红点睛 + 青苔次级色。
//   字体: Fraunces 衬线展示 + Source Sans 3 无衬线正文 + JetBrains Mono 等宽。
//   中文: Noto Serif SC 标题, Noto Sans SC 正文。
//   关键视觉: hairline 1px 边框、几乎无圆角(2-3px)、版面号、卷宗序号。
//
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  theme: {
    extend: {
      fontFamily: {
        // 衬线展示字体 — 大标题、栖字 logo、版面号
        display: [
          "Fraunces",
          "Noto Serif SC",
          "Source Han Serif SC",
          "PingFang SC",
          "ui-serif",
          "Georgia",
          "serif",
        ],
        // 衬线正文(留作长篇说明使用)
        serif: [
          "Fraunces",
          "Noto Serif SC",
          "Source Han Serif SC",
          "ui-serif",
          "Georgia",
          "serif",
        ],
        // 无衬线正文 — UI 组件、表单、按钮
        sans: [
          "Source Sans 3",
          "Noto Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        // 等宽 — 键名、版面号、序号、邮箱、URL host
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // ─── 旧色映射 (向后兼容) ──────────────────────────────────────
        // 让既有 admin tabs 用的 slate-/accent- 自动套上新 palette,
        // 不必逐个重写 markup. slate 映射到 paper/ash/ink 链;
        // accent (青色) 改为朱砂红, 让旧 link / focus ring 自动焕新.
        slate: {
          25:  "#FEFCF7",
          50:  "#FBF7EE",   // paper
          100: "#F5EEDC",   // paper-2
          200: "#ECE2C8",   // paper-3 / rule
          300: "#A8A091",   // ash-50
          400: "#918A7A",   // ash-100
          500: "#6B6354",   // ash
          600: "#544D40",   // ash-400
          700: "#3F3A30",   // ink-100
          800: "#2A271F",   // ink-200
          900: "#16130E",   // ink
          950: "#0B0906",
        },
        accent: {
          50:  "#F4E0DC",
          100: "#E8C0BA",
          200: "#D58A82",
          300: "#C25A4D",
          400: "#B33A2A",   // cinnabar
          500: "#B33A2A",
          600: "#9A2E20",
          700: "#7B2418",
          800: "#5C1B12",
          900: "#481C0E",
        },

        // ─── 设计 token (新 palette) ─────────────────────────────────
        // 纸面层叠 — 米白到浅米
        paper: {
          DEFAULT: "#FBF7EE",
          50:  "#FEFCF7",
          100: "#FBF7EE",
          200: "#F5EEDC",
          300: "#ECE2C8",
          400: "#DFD2B0",
          500: "#C9B98F",
        },
        // 墨色 — 主文字、栖字、印章
        ink: {
          DEFAULT: "#16130E",
          50:  "#5A5246",
          100: "#3F3A30",
          200: "#2A271F",
          300: "#1F1B14",
          400: "#16130E",
          500: "#0B0906",
        },
        // 灰墨 — 正文、次级文字
        ash: {
          DEFAULT: "#6B6354",
          50:  "#A8A091",
          100: "#918A7A",
          200: "#7A7263",
          300: "#6B6354",
          400: "#544D40",
          500: "#3F392E",
        },
        // 朱砂 — 主品牌、关键交互、链接
        cinnabar: {
          DEFAULT: "#B33A2A",
          50:  "#F4E0DC",
          100: "#E8C0BA",
          200: "#D58A82",
          300: "#C25A4D",
          400: "#B33A2A",
          500: "#9A2E20",
          600: "#7B2418",
          700: "#5C1B12",
        },
        // 青苔 — 状态成功、次级 accent
        sage: {
          DEFAULT: "#5C7A6B",
          50:  "#D7E1DC",
          100: "#B4C4BC",
          200: "#8AA398",
          300: "#5C7A6B",
          400: "#465F53",
          500: "#33453C",
        },
        // 赭石 — 警告、修改提示
        ochre: {
          DEFAULT: "#B5832C",
          50:  "#F0E2C2",
          100: "#E0C68A",
          200: "#CDA458",
          300: "#B5832C",
          400: "#8E661F",
          500: "#684A14",
        },
        // 锈红 — 错误
        rust: {
          DEFAULT: "#8C3A20",
          50:  "#E8C9BE",
          100: "#D49B86",
          200: "#B8674A",
          300: "#8C3A20",
          400: "#6A2B17",
          500: "#481C0E",
        },
        // 旧的 emerald/red/amber 映射,让旧 admin badge 自动焕新
        emerald: {
          50:  "#D7E1DC",
          200: "#B4C4BC",
          500: "#5C7A6B",
          600: "#465F53",
          700: "#33453C",
        },
        red: {
          50:  "#E8C9BE",
          200: "#D49B86",
          500: "#8C3A20",
          600: "#6A2B17",
          700: "#481C0E",
        },
        amber: {
          50:  "#F0E2C2",
          200: "#E0C68A",
          500: "#B5832C",
          600: "#8E661F",
          700: "#684A14",
          800: "#684A14",
        },
        // hairline 边框专用
        rule: {
          DEFAULT: "#1F1B14",
          soft: "rgba(31, 27, 20, 0.18)",
          softer: "rgba(31, 27, 20, 0.10)",
        },
      },
      boxShadow: {
        // 极克制的阴影。编辑感设计很少用 box-shadow,主要用 hairline 边框。
        hairline: "0 0 0 0.5px rgba(31, 27, 20, 0.18)",
        paper: "0 1px 0 0 rgba(31, 27, 20, 0.08), 0 0 0 0.5px rgba(31, 27, 20, 0.06)",
        seal: "0 4px 12px -4px rgba(179, 58, 42, 0.35), 0 0 0 0.5px rgba(179, 58, 42, 0.4)",
      },
      borderRadius: {
        // 编辑档案几乎不用大圆角。最多 2-3px 缓和锐角。
        none: "0",
        xs: "2px",
        sm: "3px",
        DEFAULT: "3px",
        md: "4px",
        lg: "6px",
        xl: "8px",
      },
      letterSpacing: {
        archive: "0.18em",      // ARCHIVE / № 这种全大写小字
        archive2: "0.3em",      // 极宽字距,用于卷宗号、版面号
        snug: "-0.01em",
        tight: "-0.02em",
        tighter: "-0.035em",    // Fraunces 大标题
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],     // 11px
        "tab": ["0.625rem", { lineHeight: "0.875rem" }],  // 10px - 版面号小字
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "fade-in": "fade-in 0.4s ease-out both",
        "ink-rise": "ink-rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        "ink-rise": {
          "0%": { opacity: 0, transform: "translateY(14px) scale(0.985)" },
          "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
