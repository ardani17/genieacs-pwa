import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Node runtime BFF: standalone server output, tracing rooted at the
  // repository so apps/web and packages/app-contracts are included.
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
