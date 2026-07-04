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
        ink: '#0b1014',
        paper: '#f2efe7',
        brass: '#d9a441',
        circuit: '#6ee7b7',
        danger: '#ff6b6b'
      },
      boxShadow: {
        panel: '0 24px 80px rgba(0, 0, 0, 0.32)'
      }
    }
  },
  plugins: []
}
