/** @type {import('next').NextConfig} */
const RENDER_API_URL = process.env.RENDER_API_URL || "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tradeanim/editor-core", "@tradeanim/project-schema"],
  // The browser only talks to :3000; render/project API calls are proxied to FastAPI.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${RENDER_API_URL}/api/:path*` }];
  },
  devIndicators: false,
};

export default nextConfig;
