/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Semantic palette driven by CSS variables (see index.css), so a single
      // `.dark` class on <html> reskins the whole app. Channels are stored as
      // space-separated RGB so Tailwind's `/opacity` modifiers keep working.
      colors: {
        paper: 'rgb(var(--c-paper) / <alpha-value>)', // app background
        surface: 'rgb(var(--c-surface) / <alpha-value>)', // raised panels / bubbles
        'surface-sunk': 'rgb(var(--c-surface-sunk) / <alpha-value>)', // recessed areas
        ink: 'rgb(var(--c-ink) / <alpha-value>)', // primary text
        muted: 'rgb(var(--c-muted) / <alpha-value>)', // secondary text
        faint: 'rgb(var(--c-faint) / <alpha-value>)', // tertiary / placeholder
        line: 'rgb(var(--c-line) / <alpha-value>)', // soft borders
        clay: {
          DEFAULT: 'rgb(var(--c-clay) / <alpha-value>)', // accent
          dark: 'rgb(var(--c-clay-dark) / <alpha-value>)', // accent hover/active
          soft: 'rgb(var(--c-clay-soft) / <alpha-value>)', // soft tint for surfaces
        },
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        raised: 'var(--shadow-raised)',
      },
    },
  },
  plugins: [],
}
