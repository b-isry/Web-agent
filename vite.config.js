import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyDirOutDir: true,
    rollupOptions: {
      input: { content: resolve(__dirname, 'content/index.jsx') },
      output: {
        entryFileNames: 'content.js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'content.css' : '[name][extname]',
      },
    },
  },
});
