import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-version',
      buildStart() {
        let gitHash = 'dev';
        try { gitHash = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}
        const version = { version: gitHash, buildTime: new Date().toISOString() };
        writeFileSync(resolve(__dirname, 'public', 'version.json'), JSON.stringify(version));
      }
    }
  ],
})
