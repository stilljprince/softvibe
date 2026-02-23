// tailwind.config.cjs
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        testpink: "#ff00ff",
      },
    },
  },
  plugins: [
    function ({ addVariant }) {
      addVariant("pastel", ["&.pastel", ":is(.pastel &)"]);
    },
  ],
};