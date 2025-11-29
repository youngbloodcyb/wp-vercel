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

  sendUpdate('Creating sandbox...', 'sandbox-create');
  const sandbox = await Sandbox.create({
    timeout: ms('30m'),
    resources: { vcpus: 4 },
    ports: [3000],
    runtime: 'node22'
  });
  console.log('Sandbox created:', sandbox.sandboxId);

  // 1) Install PHP + nginx + php-fpm
  sendUpdate('Installing PHP, nginx, and PHP-FPM...');
  const phpInstall = await sandbox.runCommand({
    cmd: 'dnf',
    args: [
      'install',
      '-y',
      'nginx',
      'php8.1-cli',
      'php8.1-fpm',
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
    console.error('PHP/nginx install failed');
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

  // 4) Configure php-fpm and nginx
  sendUpdate('Configuring nginx and PHP-FPM...');

  // php-fpm pool: listen on 127.0.0.1:9000 to match fastcgi_pass
  const phpFpmPoolConfig = `
[www]
user = nginx
group = nginx
listen = 127.0.0.1:9000
listen.allowed_clients = 127.0.0.1
pm = dynamic
pm.max_children = 5
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
catch_workers_output = yes
`;

  // Single-site nginx config, adapted from WordPress docs:
  // https://developer.wordpress.org/advanced-administration/server/web-server/nginx/
  const nginxServerConfig = `
server {
  listen 3000 default_server;
  server_name _;

  # WordPress root
  root /vercel/sandbox/wordpress;
  index index.php index.html index.htm;

  # Favicon and robots
  location = /favicon.ico {
    log_not_found off;
    access_log off;
  }

  location = /robots.txt {
    allow all;
    log_not_found off;
    access_log off;
  }

  # Main front controller
  location / {
    # No PHP for static content, fall back to index.php for WP routing
    try_files $uri $uri/ /index.php?$args;
  }

  # PHP handling (php-fpm)
  location ~ \\.php$ {
    # WordPress docs recommend this with cgi.fix_pathinfo=0 in php.ini
    include fastcgi.conf;
    fastcgi_intercept_errors on;
    fastcgi_pass 127.0.0.1:9000;
  }

  # Static assets
  location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|webp)$ {
    expires max;
    log_not_found off;
  }
}
`;

  // Write configs using sudo via heredoc
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      `cat << 'EOF' > /etc/php-fpm.d/www.conf
${phpFpmPoolConfig}
EOF`
    ],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      `cat << 'EOF' > /etc/nginx/conf.d/wordpress.conf
${nginxServerConfig}
EOF`
    ],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // Ensure php-fpm PID directory exists
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'mkdir -p /run/php-fpm'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // Test configs before starting services
  const phpFpmTest = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'php-fpm -t'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });
  console.log('php-fpm test exit:', phpFpmTest.exitCode);
  if (phpFpmTest.exitCode !== 0) {
    console.error('php-fpm config test failed');
    process.exit(1);
  }

  const nginxTest = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'nginx -t'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });
  console.log('nginx test exit:', nginxTest.exitCode);
  if (nginxTest.exitCode !== 0) {
    console.error('nginx config test failed');
    process.exit(1);
  }

  // 5) Start php-fpm and nginx instead of php -S
  sendUpdate('Starting PHP-FPM and nginx on :3000...');

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'php-fpm -F'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr,
    detached: true
  });

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'nginx -g "daemon off;"'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr,
    detached: true
  });

  return sandbox;
};
