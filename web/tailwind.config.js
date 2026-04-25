/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js}"],
  theme: {
    extend: {
      colors: {
        // Project color name "栖枢" → "perch + pivot". Pick a calm
        // ink-blue accent that reads well on light and dark.
        ink: {
          50: "#f0f5fa",
          100: "#dde8f3",
          200: "#b8d0e6",
          300: "#82aed1",
          400: "#4d87b8",
          500: "#2e6a9d",
          600: "#1f527e",
          700: "#1a4267",
          800: "#163755",
          900: "#122c44",
          950: "#0a1a29",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          '"Helvetica Neue"',
          "Helvetica",
          "Arial",
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
