import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function strictBuildCspPlugin(): Plugin {
  return {
    name: 'strict-build-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;" />`
      );
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), strictBuildCspPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
