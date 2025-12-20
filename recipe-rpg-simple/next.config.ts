import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@penrose/core', 'mathjax-full'],
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;
