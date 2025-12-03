// build.ts - Unified build script for Vercel
import { initSandbox } from '@/lib/sandbox';
import { Sandbox } from '@vercel/sandbox';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({
  path: `.env.${process.env.NODE_ENV || 'local'}`
});

async function main() {
  console.log('=== Starting sandbox ===');
  const sandbox = await initSandbox();

  const url = sandbox.domain(3000);
  const sandboxId = sandbox.sandboxId;

  console.log('WordPress is live at:', url);
  console.log('Sandbox ID:', sandboxId);

  // Write config files for reference
  const configPath = path.join(process.cwd(), 'sandbox.config.mjs');
  fs.writeFileSync(
    configPath,
    `export const WORDPRESS_URL = ${JSON.stringify(
      url
    )};\nexport const SANDBOX_ID = ${JSON.stringify(sandboxId)};\n`
  );

  console.log('=== Running Next.js build ===');

  // Run next build with WORDPRESS_URL set in the environment
  const buildProcess = spawn('npx', ['next', 'build'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      WORDPRESS_URL: url,
      SANDBOX_ID: sandboxId
    },
    shell: true
  });

  const exitCode = await new Promise<number>((resolve) => {
    buildProcess.on('close', (code) => resolve(code ?? 1));
  });

  console.log('=== Stopping sandbox ===');

  try {
    const sandboxInstance = await Sandbox.get({ sandboxId });
    await sandboxInstance.stop();
    console.log('Sandbox stopped successfully.');
  } catch (error) {
    console.log(
      'Could not stop sandbox:',
      error instanceof Error ? error.message : 'unknown error'
    );
  }

  // Clean up config file
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
