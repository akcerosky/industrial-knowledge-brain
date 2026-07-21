/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f1720",
        steel: "#304254",
        signal: "#f97316",
        mist: "#d7e2eb",
        paper: "#f5f2e9",
      },
    },
  },
  plugins: [],
};

