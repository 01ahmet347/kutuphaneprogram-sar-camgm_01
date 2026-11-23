import { writeFileSync, readFileSync } from 'node:fs';
const version = /APP_VERSION = '([^']+)'/.exec(readFileSync(new URL('../src/version.js', import.meta.url), 'utf8'))[1];
writeFileSync(new URL('../public/version.json', import.meta.url), JSON.stringify({ version, commit: process.env.VERCEL_GIT_COMMIT_SHA || 'local' }) + '\n');
