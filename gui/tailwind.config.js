import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  content: [
    resolve(__dirname, './index.html'),
    resolve(__dirname, './src/**/*.{ts,tsx}'),
  ],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};
