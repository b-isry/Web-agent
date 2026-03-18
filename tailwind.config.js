/** @type {import('tailwindcss').Config} */
export default {
  content: ['./content/**/*.{js,jsx}'],
  important: '#uwa-legibility-root',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
