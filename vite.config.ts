import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Plugin to fix HTML for Electron file:// compatibility:
// - Remove type="module" and crossorigin attributes
// - Move <script> to end of <body> so DOM (#root) exists when IIFE executes
function electronCompat(): Plugin {
  return {
    name: 'electron-compat',
    enforce: 'post',
    writeBundle(options) {
      const dir = options.dir;
      if (!dir) return;
      const htmlPath = path.join(dir, 'index.html');
      if (!fs.existsSync(htmlPath)) return;
      let html = fs.readFileSync(htmlPath, 'utf-8');
      // Remove type="module" and crossorigin attributes
      html = html.replace(/type="module"\s+/g, '');
      html = html.replace(/\scrossorigin\s*/g, ' ');
      // Extract all <script> tags and move them to before </body>
      const scriptMatches: string[] = [];
      html = html.replace(/<script\b[^>]*><\/script>/g, (match) => {
        scriptMatches.push(match);
        return '';
      });
      // Insert scripts before </body>
      if (scriptMatches.length > 0) {
        html = html.replace('</body>', scriptMatches.join('\n') + '\n</body>');
      }
      fs.writeFileSync(htmlPath, html);
    },
  };
}

export default defineConfig({
  plugins: [react(), electronCompat()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
      },
    },
  },
  server: {
    port: 5173,
  },
});
