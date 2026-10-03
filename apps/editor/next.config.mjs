import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(here, "../..");
const isProd = process.env.NODE_ENV === "production";

// The browser talks to the render API directly at NEXT_PUBLIC_API_URL (see .env.*).
if (isProd && process.env.NEXT_PUBLIC_API_URL === undefined) {
  console.warn("[AlgoLiquid Studio] NEXT_PUBLIC_API_URL is not set: the editor will call the API on its own origin (/api).");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@tradeanim/editor-core", "@tradeanim/project-schema"],
  // Workspace packages live outside apps/editor.
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  // `NEXT_OUTPUT=standalone npm run build` produces a self-contained server for containers.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
