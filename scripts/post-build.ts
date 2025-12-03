// post-build.ts - Stop any running sandboxes
import { Sandbox } from '@vercel/sandbox';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({
  path: `.env.${process.env.NODE_ENV || 'local'}`
});

async function main() {
  const configPath = path.join(process.cwd(), 'sandbox.config.mjs');

  // Check if config file exists
  if (!fs.existsSync(configPath)) {
    console.log('No sandbox.config.mjs found, nothing to clean up.');
    return;
  }

  // Read the sandbox ID from the config file
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const sandboxIdMatch = configContent.match(/SANDBOX_ID\s*=\s*"([^"]+)"/);

  if (!sandboxIdMatch) {
    console.log('No SANDBOX_ID found in config, nothing to clean up.');
    return;
  }

  const sandboxId = sandboxIdMatch[1];
  console.log('Stopping sandbox:', sandboxId);

  try {
    // Get the existing sandbox by ID and stop it
    const sandbox = await Sandbox.get({ sandboxId });
    await sandbox.stop();
    console.log('Sandbox stopped successfully.');
  } catch (error) {
    // Sandbox might already be stopped or expired
    console.log(
      'Could not stop sandbox (may already be stopped):',
      error instanceof Error ? error.message : 'unknown error'
    );
  }

  // Clean up the config file
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    console.log('Removed sandbox.config.mjs');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
