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

  // 1) Install PHP + Apache (httpd) + PHP-FPM per AL2023 guide
  sendUpdate('Installing PHP and Apache (httpd)...');
  const phpInstall = await sandbox.runCommand({
    cmd: 'dnf',
    args: [
      'install',
      '-y',
      'wget',
      'php-mysqlnd',
      'httpd',
      'php-fpm',
      'php-mysqli',
      'mariadb105-server',
      'php-json',
      'php',
      'php-devel'
    ],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });
  if (phpInstall.exitCode !== 0) {
    console.error('PHP/Apache install failed');
    process.exit(1);
  }

  // Configure PHP-FPM to listen on socket and run as apache user
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      [
        "sed -i 's/^user = .*/user = apache/' /etc/php-fpm.d/www.conf",
        "sed -i 's/^group = .*/group = apache/' /etc/php-fpm.d/www.conf",
        "sed -i 's|^listen = .*|listen = /run/php-fpm/www.sock|' /etc/php-fpm.d/www.conf",
        "sed -i 's/^;listen.owner = .*/listen.owner = apache/' /etc/php-fpm.d/www.conf",
        "sed -i 's/^;listen.group = .*/listen.group = apache/' /etc/php-fpm.d/www.conf",
        "sed -i 's/^;listen.mode = .*/listen.mode = 0660/' /etc/php-fpm.d/www.conf"
      ].join(' && ')
    ],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // 2) Download WordPress
  sendUpdate('Downloading WordPress...');

  const wpDownload = await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      'cd /vercel/sandbox && wget https://wordpress.org/latest.tar.gz && tar -xzf latest.tar.gz'
    ],
    stdout: process.stdout,
    stderr: process.stderr
  });

  if (wpDownload.exitCode !== 0) {
    console.error('WordPress download failed');
    process.exit(1);
  }

  // Copy sample config as a base (not strictly needed, but mirrors upstream flow)
  const wpConfigSampleCopy = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'cp wordpress/wp-config-sample.php wordpress/wp-config.php'],
    stdout: process.stdout,
    stderr: process.stderr
  });
  if (wpConfigSampleCopy.exitCode !== 0) {
    console.warn(
      'Could not copy wp-config-sample.php (will overwrite with our own config anyway).'
    );
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

  // Optional: ownership (helps with logs/uploads where relevant)
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'chown -R apache:apache /vercel/sandbox/wordpress || true'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // 3) Configure wp-config.php for external DB
  //   sendUpdate('Configuring WordPress database...');

  //   const publicUrl = process.env.MYSQL_PUBLIC_URL!;
  //   const parsed = new URL(publicUrl);

  //   const dbName =
  //     process.env.MYSQLDATABASE ||
  //     process.env.MYSQL_DATABASE ||
  //     parsed.pathname.replace(/^\//, '');
  //   const dbUser = process.env.MYSQLUSER || parsed.username;
  //   const dbPassword =
  //     process.env.MYSQLPASSWORD ||
  //     process.env.MYSQL_ROOT_PASSWORD ||
  //     parsed.password;
  //   const dbHost = parsed.hostname;
  //   const dbPort = parsed.port || '3306';

  //   console.log('Using DB config:', { dbHost, dbPort, dbName, dbUser });

  //   // Generate random keys for WordPress security
  //   // Using only characters safe for PHP single-quoted strings (no single quotes or backslashes)
  //   const generateKey = () => {
  //     const chars =
  //       'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#%^&*()-_[]{}|;:,.?';
  //     let key = '';
  //     for (let i = 0; i < 64; i++) {
  //       key += chars.charAt(Math.floor(Math.random() * chars.length));
  //     }
  //     return key;
  //   };

  //   const wpConfig = `<?php
  //   define( 'DB_NAME', '${dbName}' );
  //   define( 'DB_USER', '${dbUser}' );
  //   define( 'DB_PASSWORD', '${dbPassword}' );
  //   define( 'DB_HOST', '${dbHost}:${dbPort}' );
  //   define( 'DB_CHARSET', 'utf8mb4' );
  //   define( 'DB_COLLATE', '' );

  //   /**
  //    * Authentication Unique Keys and Salts.
  //    * Generate new ones at: https://api.wordpress.org/secret-key/1.1/salt/
  //    */
  //   define( 'AUTH_KEY',         '${generateKey()}' );
  //   define( 'SECURE_AUTH_KEY',  '${generateKey()}' );
  //   define( 'LOGGED_IN_KEY',    '${generateKey()}' );
  //   define( 'NONCE_KEY',        '${generateKey()}' );
  //   define( 'AUTH_SALT',        '${generateKey()}' );
  //   define( 'SECURE_AUTH_SALT', '${generateKey()}' );
  //   define( 'LOGGED_IN_SALT',   '${generateKey()}' );
  //   define( 'NONCE_SALT',       '${generateKey()}' );

  //   $table_prefix = 'wp_';

  //   define( 'WP_DEBUG', true );

  //   /* Handle reverse proxy / load balancer HTTPS */
  //   if (
  //       isset($_SERVER['HTTP_X_FORWARDED_PROTO']) &&
  //       $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https'
  //   ) {
  //       $_SERVER['HTTPS'] = 'on';
  //   }

  //   define( 'WP_HOME', 'https://' . $_SERVER['HTTP_HOST'] );
  //   define( 'WP_SITEURL', 'https://' . $_SERVER['HTTP_HOST'] );

  //   /* That's all, stop editing! Happy publishing. */
  //   if ( ! defined( 'ABSPATH' ) ) {
  //       define( 'ABSPATH', __DIR__ . '/' );
  //   }

  //   require_once ABSPATH . 'wp-settings.php';
  //   `;

  //   await sandbox.writeFiles([
  //     {
  //       path: '/vercel/sandbox/wordpress/wp-config.php',
  //       content: Buffer.from(wpConfig)
  //     }
  //   ]);

  // 4) Configure Apache (httpd) for WordPress with PHP-FPM
  sendUpdate('Configuring Apache for WordPress...');

  // No need to touch proxy modules; they're already loaded on AL2023.

  const httpdVhostConfig = `ServerName localhost
 
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
 
     # PHP-FPM handler via Unix socket
     <FilesMatch \\.php$>
         SetHandler "proxy:unix:/run/php-fpm/www.sock|fcgi://localhost"
     </FilesMatch>
 </VirtualHost>
 
 # Listen on port 3000 for this vhost
 Listen 3000
 `;

  // Write the vhost config as a regular file, then move it into place with sudo
  await sandbox.writeFiles([
    {
      path: '/vercel/sandbox/wordpress.conf',
      content: Buffer.from(httpdVhostConfig)
    }
  ]);

  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      'mv /vercel/sandbox/wordpress.conf /etc/httpd/conf.d/wordpress.conf'
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

  // 6) Start PHP-FPM and Apache (httpd) on :3000
  sendUpdate('Starting PHP-FPM and Apache (httpd) on :3000...');

  // Kill any stray processes from earlier runs
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'pkill httpd || true; pkill php-fpm || true'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // Create PHP-FPM socket directory
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'mkdir -p /run/php-fpm && chown apache:apache /run/php-fpm'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr
  });

  // Start PHP-FPM in the background
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'php-fpm'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr,
    detached: true
  });

  // Give PHP-FPM a moment to create the socket
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Start Apache
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'httpd -DFOREGROUND'],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr,
    detached: true
  });

  console.log('WordPress should be available at:', sandbox.domain(3000));

  return sandbox;
};
