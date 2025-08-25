import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

// Conditional Vite config: default = SPA build (index.html)
// Use `--mode lib` for the BigCommerce IIFE bundle.
export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib';

  return {
    plugins: [react(), isLib && cssInjectedByJsPlugin()].filter(Boolean),
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': {},
      global: 'window',
    },
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
              intro: 'window.process = window.process || { env: { NODE_ENV: "production" } };',
            },
          },
          cssCodeSplit: false,

         // IMPORTANT: When finished debugging, you can flip these back to sourcemap: false and
         // remove minify: false (or set minify: 'esbuild') for a smaller, faster bundle.Set
         // sourcemap
          sourcemap: true,
          minify: false,

          // IMPORTANT: when running a combined build, we don't want the lib build
          // to wipe out the SPA files. We'll set this via the CLI in scripts.
          // emptyOutDir will be controlled by the CLI in package.json.
        }
      : {
          // --- Default SPA build (keeps https://...netlify.app working) ---
          sourcemap: false,
        },
  };
});
