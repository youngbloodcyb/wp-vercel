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
  const totalSteps = 6;
  let currentStep = 0;

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

  // 0) Create sandbox
  sendUpdate('Creating sandbox...', 'sandbox-create');
  const sandbox = await Sandbox.create({
    timeout: ms('30m'),
    resources: { vcpus: 4 },
    ports: [3000],
    runtime: 'node22'
  });
  console.log('Sandbox created:', sandbox.sandboxId);

  // 1) Install PHP + Apache (httpd)
  sendUpdate('Installing PHP and Apache (httpd)...');
  const phpInstall = await sandbox.runCommand({
    cmd: 'dnf',
    args: [
      'install',
      '-y',
      'httpd',
      'php8.1',
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
    console.error('PHP/Apache install failed');
    process.exit(1);
  }

  // 2) Download WordPress
  sendUpdate('Downloading WordPress...');
  const wpDownload = await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      [
        'set -e',
        'cd /vercel/sandbox',
        'curl -fL https://wordpress.org/latest.tar.gz -o latest.tar.gz',
        'ls -lh latest.tar.gz',
        'mkdir -p wordpress',
        'tar -xzf latest.tar.gz -C wordpress --strip-components=1',
        'rm latest.tar.gz'
      ].join(' && ')
    ],
    stdout: process.stdout,
    stderr: process.stderr
  });

  console.log('WordPress download exit code:', wpDownload.exitCode);
  if (wpDownload.exitCode !== 0) {
    console.error('WordPress download/extract failed');
    process.exit(1);
  }

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'ls -lah /vercel/sandbox/wordpress'],
    stdout: process.stdout,
    stderr: process.stderr
  });

  // Ensure Apache can traverse all parent directories and read files
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      [
        'chmod 755 /vercel || true',
        'chmod 755 /vercel/sandbox || true',
        'chmod -R 755 /vercel/sandbox/wordpress || true'
      ].join(' && ')
    ],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // Optional: ownership (not strictly required if perms are 755)
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'chown -R apache:apache /vercel/sandbox/wordpress || true'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // 3) Configure wp-config.php
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
  const dbHost = parsed.hostname;
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

  // 4) Configure Apache (httpd) for WordPress
  sendUpdate('Configuring Apache for WordPress...');

  const httpdVhostConfig = `
ServerName localhost

<VirtualHost *:3000>
    ServerName localhost

    DocumentRoot /vercel/sandbox/wordpress

    # Allow Apache to serve everything under /vercel
    <Directory "/vercel">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <Directory "/vercel/sandbox">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <Directory "/vercel/sandbox/wordpress">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    DirectoryIndex index.php index.html

    ErrorLog /var/log/httpd/wordpress-error.log
    CustomLog /var/log/httpd/wordpress-access.log combined

    <FilesMatch \\.php$>
        SetHandler application/x-httpd-php
    </FilesMatch>
</VirtualHost>

# Listen on port 3000 for this vhost
Listen 3000
`;

  // Write Apache vhost config
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      `cat << 'EOF' > /etc/httpd/conf.d/wordpress.conf
${httpdVhostConfig}
EOF`
    ],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // 5) Test Apache config
  const httpdTest = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'httpd -t'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });
  console.log('httpd config test exit:', httpdTest.exitCode);
  if (httpdTest.exitCode !== 0) {
    console.error('Apache (httpd) config test failed');
    process.exit(1);
  }

  // 6) Start Apache (httpd) on :3000
  sendUpdate('Starting Apache (httpd) on :3000...');

  // Kill any stray httpd from earlier runs
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'pkill httpd || true'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'httpd -DFOREGROUND'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr,
    detached: true
  });

  return sandbox;
};
