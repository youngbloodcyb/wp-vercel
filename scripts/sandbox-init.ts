// wp-sandbox.ts
import { initSandbox } from '@/lib/sandbox';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({
  path: `.env.${process.env.NODE_ENV || 'local'}`
});

async function main() {
  const sandbox = await initSandbox();

  const url = sandbox.domain(3000);
  console.log('WordPress is live at:', url);

  // Write the sandbox URL to a config file
  const outPath = path.join(process.cwd(), 'sandbox.config.mjs');
  const contents = `export const WORDPRESS_URL = ${JSON.stringify(url)};\n`;

  fs.writeFileSync(outPath, contents);
  console.log('Sandbox URL written to sandbox.config.mjs:', url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
