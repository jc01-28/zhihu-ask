import type { Config } from 'tailwindcss';

const config: Config = {
  // 只扫 Next 侧自己的模板。src/frontend 是 Vite SPA（Tailwind 4，另一套配置），
  // 让 Tailwind 3 去扫它会白白拖慢构建，且两者版本不兼容。
  content: ['./src/app/**/*.{ts,tsx}', './src/front/**/*.{ts,tsx}', './src/shared/**/*.{ts,tsx}'],
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
