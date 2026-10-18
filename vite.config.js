import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

// Determine the build version reliably from Render environment or local git
function getBuildVersion() {
  if (process.env.RENDER_GIT_COMMIT) {
    return process.env.RENDER_GIT_COMMIT.substring(0, 7);
  }
  if (process.env.COMMIT_REF) {
    return process.env.COMMIT_REF.substring(0, 7);
  }
  try {
    const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
    if (gitHash) return gitHash;
  } catch {}
  return Date.now().toString(36);
}

const buildVersion = getBuildVersion();
const buildTime = new Date().toISOString();
const versionData = { version: buildVersion, buildTime };

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    {
      name: 'emit-version',
      buildStart() {
        const publicDir = resolve(__dirname, 'public');
        if (!existsSync(publicDir)) {
          mkdirSync(publicDir, { recursive: true });
        }
        writeFileSync(resolve(publicDir, 'version.json'), JSON.stringify(versionData, null, 2));
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify(versionData, null, 2),
        });
      },
    },
  ],
})
