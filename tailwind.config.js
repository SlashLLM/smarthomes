import forms from "@tailwindcss/forms";

/** Warm Architectural palette — see the Stitch export's DESIGN.md. */
export default {
  content: ["./index.html", "./admin/**/*.html", "./report/**/*.html", "./src/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          white: "#FFFFFF",
          cream: "#FFF8E7",
          apricot: "#FFE4B5",
          peach: "#FFDAB9",
          papaya: "#FFEFD5",
          accent: "#C85A32",
          accentDark: "#A6431E",
          ink: "#2D241E",
          inkMuted: "#685950",
          // Darkened from the export's #8F7D73, which fails 4.5:1 on cream.
          inkSoft: "#766359",
          borderTone: "#F3D5B5",
          cardDark: "#2B221B",
        },
      },
      borderRadius: {
        wavy: "2rem",
        scallop: "1.75rem",
        super: "2.5rem",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(45,36,30,0.06)",
      },
    },
  },
  plugins: [forms({ strategy: "class" })],
};
