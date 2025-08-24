
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Conditional Vite config: default = SPA build (index.html)
// Use `--mode lib` for the BigCommerce IIFE bundle.
export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib';

  return {
    plugins: [react()],
    build: isLib
      ? {
          // --- IIFE bundle for BigCommerce injection ---
          lib: {
            entry: 'src/App.jsx', // entry includes auto-mount code
            name: 'RbgDesignerWidget',
            formats: ['iife'],
            fileName: () => 'rbg-designer.iife.js',
          },
          rollupOptions: {
            external: [],
            output: {
              inlineDynamicImports: true,
            },
          },
          cssCodeSplit: false,
          sourcemap: false,
          // IMPORTANT: when running a combined build, we don't want the lib build
          // to wipe out the SPA files. We'll set this via the CLI in scripts.
          // emptyOutDir will be controlled by the CLI in package.json..
        }
      : {
          // --- Default SPA build (keeps https://...netlify.app working) ---
          sourcemap: false,
        },
  };
});
