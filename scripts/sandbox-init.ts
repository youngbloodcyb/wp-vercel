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
  const sandboxId = sandbox.sandboxId;

  console.log('WordPress is live at:', url);
  console.log('Sandbox ID:', sandboxId);

  // Write the sandbox URL and ID to a config file
  const outPath = path.join(process.cwd(), 'sandbox.config.mjs');
  const contents = `export const WORDPRESS_URL = ${JSON.stringify(url)};
export const SANDBOX_ID = ${JSON.stringify(sandboxId)};
`;

  fs.writeFileSync(outPath, contents);
  console.log('Sandbox config written to sandbox.config.mjs');

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
