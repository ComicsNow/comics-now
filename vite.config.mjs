import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public',
  base: './',
  // Disable default publicDir copying since the root itself is the 'public' directory.
  // This avoids recursive directory copies during development and build.
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Ensure sourcemaps are generated to help with any potential debugging
    sourcemap: true,
    // Set a generous chunk size limit if needed
    chunkSizeWarningLimit: 1000,
  },
  server: {
    // Port for the Vite dev server
    port: 5173,
    // Proxy API requests to our Express backend
    proxy: {
      '/api': 'http://localhost:3000',
      '/thumbnails': 'http://localhost:3000',
      '/icons': 'http://localhost:3000',
      '/logos': 'http://localhost:3000'
    }
  }
});
