import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Next.js Image component needs this for static exports
  images: {
    unoptimized: true,
  },

  allowedDevOrigins: [
    "10.90.77.44",
    "10.*.*.*",
    "192.168.*.*",
    "172.*.*.*",
    "localhost",
    "127.0.0.1",
    "*.local",
  ],
};

export default nextConfig;