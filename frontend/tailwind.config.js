/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef3ff',
          100: '#e0e7ff',
          500: '#0d6efd',
          600: '#0b5ed7',
          700: '#0a58ca',
        },
        gray: {
          50: '#f7f7f9',
          100: '#f5f5f5',
          600: '#666666',
          700: '#222222',
        }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Ubuntu', 'Cantarell', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'],
      }
    },
  },
  plugins: [],
}
