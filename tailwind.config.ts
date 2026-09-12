import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0f1115',
          700: '#3a4150',
          500: '#6b7280',
          300: '#9ca3af',
        },
        brand: {
          DEFAULT: '#1f5fbf',
          soft: '#eef4ff',
        },
      },
    },
  },
  plugins: [],
};

export default config;
