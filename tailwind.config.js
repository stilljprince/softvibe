// tailwind.config.js
export default {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        testpink: "#ff00ff", // Testfarbe (knall-pink)
      },
    },
  },
  plugins: [
    function ({ addVariant }) {
      addVariant("pastel", [
        "&.pastel",       // direkt am Element
        ":is(.pastel &)", // falls <html class="pastel"> gesetzt ist
      ]);
    },
  ],
};


