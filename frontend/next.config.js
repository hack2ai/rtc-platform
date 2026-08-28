/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol:'https', hostname:'lh3.googleusercontent.com' },
      { protocol:'https', hostname:'firebasestorage.googleapis.com' },
      { protocol:'https', hostname:'storage.googleapis.com' },
    ],
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
