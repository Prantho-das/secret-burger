import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        'gray-900': '#111827',
        'gray-800': '#1F2937',
        'gray-700': '#374151',
        'gray-400': '#9CA3AF',
        'indigo-500': '#6366F1',
        'indigo-600': '#4F46E5',
      },
      fontFamily: {
        'mono': ['"Share Tech Mono"', 'monospace'],
      }
    },
  },
  plugins: [],
};
export default config;
