// tailwind.config.js
const config = {
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

export default config;

