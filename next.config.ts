import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: `${process.env.WORDPRESS_HOSTNAME}`,
        port: '',
        pathname: '/**'
      }
    ]
  }
};

export default nextConfig;
