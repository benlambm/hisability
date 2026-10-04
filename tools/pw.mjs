// Load Playwright from a local install, falling back to the global one.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);

function load() {
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return require(`${root}/playwright`);
  }
}

const pw = load();
export const { chromium, devices } = pw;
export default pw;
