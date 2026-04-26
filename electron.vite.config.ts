import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { resolve } from 'path';

const guiRoot = resolve(__dirname, 'gui');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { main: resolve(__dirname, 'electron/main.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { preload: resolve(__dirname, 'electron/preload.ts') },
      },
    },
  },
  renderer: {
    root: guiRoot,
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(guiRoot, 'index.html'),
      },
    },
    css: {
      postcss: {
        plugins: [
          tailwind({
            content: [
              resolve(guiRoot, 'index.html'),
              resolve(guiRoot, 'src/**/*.{ts,tsx}'),
            ],
            darkMode: 'class',
            theme: { extend: {} },
          }),
          autoprefixer(),
        ],
      },
    },
    plugins: [react()],
  },
});
