import ms from 'ms';
import { Sandbox, type Sandbox as SandboxType } from '@vercel/sandbox';

type StepUpdate = {
  action: string;
  step: number;
  totalSteps: number;
  text: string;
};

export const initSandbox = async ({
  controller
}: {
  controller?: ReadableStreamDefaultController;
} = {}): Promise<SandboxType> => {
  const totalSteps = 5;
  let currentStep = 0;

  // Helper function to send updates to the stream
  const sendUpdate = (text: string, action: string = 'processing') => {
    if (controller) {
      currentStep++;
      const payload: StepUpdate = {
        action,
        step: currentStep,
        totalSteps,
        text
      };
      const line = JSON.stringify(payload) + '\n';
      controller.enqueue(new TextEncoder().encode(line));
    }
    console.log(text);
  };

  sendUpdate('Creating sandbox...', 'sandbox-create');
  const sandbox = await Sandbox.create({
    timeout: ms('30m'),
    resources: { vcpus: 4 },
    ports: [3000],
    runtime: 'node22'
  });
  console.log('Sandbox created:', sandbox.sandboxId);

  sendUpdate('Installing PHP...');
  const phpInstall = await sandbox.runCommand({
    cmd: 'dnf',
    args: [
      'install',
      '-y',
      'php8.1-cli',
      'php8.1-mysqlnd',
      'php8.1-gd',
      'php8.1-mbstring',
      'php8.1-xml',
      'php8.1-opcache'
    ],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });
  if (phpInstall.exitCode !== 0) {
    console.error('PHP install failed');
    process.exit(1);
  }

  sendUpdate('Downloading WordPress...');
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      [
        'cd /vercel/sandbox',
        'curl -L https://wordpress.org/latest.tar.gz -o latest.tar.gz',
        'tar -xzf latest.tar.gz',
        'rm latest.tar.gz'
      ].join(' && ')
    ],
    stdout: process.stdout,
    stderr: process.stderr
  });

  sendUpdate('Configuring WordPress database...');

  const publicUrl = process.env.MYSQL_PUBLIC_URL!;
  const parsed = new URL(publicUrl);

  const dbName =
    process.env.MYSQLDATABASE ||
    process.env.MYSQL_DATABASE ||
    parsed.pathname.replace(/^\//, '');
  const dbUser = process.env.MYSQLUSER || parsed.username;
  const dbPassword =
    process.env.MYSQLPASSWORD ||
    process.env.MYSQL_ROOT_PASSWORD ||
    parsed.password;
  const dbHost = parsed.hostname; // e.g. ballast.proxy.rlwy.net
  const dbPort = parsed.port || '3306';

  console.log('Using DB config:', { dbHost, dbPort, dbName, dbUser });

  const wpConfig = `
  <?php
    define( 'DB_NAME', '${dbName}' );
    define( 'DB_USER', '${dbUser}' );
    define( 'DB_PASSWORD', '${dbPassword}' );
    define( 'DB_HOST', '${dbHost}:${dbPort}' );
    define( 'DB_CHARSET', 'utf8mb4' );
    define( 'DB_COLLATE', '' );

    define( 'WP_HOME', 'https://' . $_SERVER['HTTP_HOST'] );
    define( 'WP_SITEURL', 'https://' . $_SERVER['HTTP_HOST'] );

    if (
        isset($_SERVER['HTTP_X_FORWARDED_PROTO']) &&
        $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https'
    ) {
        $_SERVER['HTTPS'] = 'on';
    }

    $table_prefix = 'wp_';
    define( 'WP_DEBUG', true );

    if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/' );
    }
    require_once ABSPATH . 'wp-settings.php';
  `;

  await sandbox.writeFiles([
    {
      path: '/vercel/sandbox/wordpress/wp-config.php',
      content: Buffer.from(wpConfig)
    }
  ]);

  sendUpdate('Starting PHP server on :3000...');
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'cd /vercel/sandbox/wordpress && php -S 0.0.0.0:3000 -t .'],
    stdout: process.stdout,
    stderr: process.stderr,
    detached: true
  });

  return sandbox;
};
