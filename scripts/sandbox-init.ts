// wp-sandbox.ts
import { initSandbox } from '@/lib/sandbox';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config({
  path: `.env.${process.env.NODE_ENV || 'local'}`
});

async function main() {
  const sandbox = await initSandbox();

  setTimeout(() => {
    const url = sandbox.domain(3000);
    console.log('WordPress is live at:', url);
    try {
      spawn('open', [url]);
    } catch {}
  }, 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
