/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Avenir Next"', '"Segoe UI Variable Display"', 'system-ui', 'sans-serif'],
        mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'monospace']
      },
      colors: {
        // All palette tokens are CSS-variable channel triplets defined in main.css,
        // so the whole app flips between dark and light via prefers-color-scheme
        // (driven by nativeTheme.themeSource in the main process).
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        brass: 'rgb(var(--brass) / <alpha-value>)',
        circuit: 'rgb(var(--circuit) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        // Remap `white` to the theme foreground so the pervasive text-white/45,
        // bg-white/5, border-white/25 utilities become theme-aware automatically.
        white: 'rgb(var(--fg) / <alpha-value>)',
        // Solid elevated surfaces read cleaner than translucent glass.
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)'
        },
        // Hairline borders as semantic tokens (replaces scattered white/10).
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)'
        }
      },
      borderRadius: {
        field: '0.75rem',
        card: '1rem',
        panel: '1.25rem'
      },
      boxShadow: {
        soft: '0 8px 30px rgba(0, 0, 0, 0.22)',
        panel: '0 24px 80px rgba(0, 0, 0, 0.36)',
        glow: '0 0 0 1px rgb(var(--circuit) / 0.35), 0 10px 30px rgb(var(--circuit) / 0.12)'
      }
    }
  },
  plugins: []
}
