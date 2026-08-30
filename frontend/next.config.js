/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow local/LAN hosts and the current ngrok development host to load
  // Next.js development assets when testing the app through a tunnel.
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    process.env.NEXT_PUBLIC_APP_HOST || '192.168.100.10',
    '816c-89-38-97-206.ngrok-free.app',
  ],
  reactStrictMode: true,
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol:'https', hostname:'lh3.googleusercontent.com' },
      { protocol:'https', hostname:'firebasestorage.googleapis.com' },
      { protocol:'https', hostname:'storage.googleapis.com' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api-proxy/:path*',
        destination: `${process.env.API_PROXY_TARGET || 'http://127.0.0.1:8080'}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [{ source:'/(.*)', headers:[
      { key:'X-Frame-Options', value:'DENY' },
      { key:'X-Content-Type-Options', value:'nosniff' },
      { key:'Permissions-Policy', value:'camera=*, microphone=*, display-capture=*' },
    ]}];
  },
};
module.exports = nextConfig;
