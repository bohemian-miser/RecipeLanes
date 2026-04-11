/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.DIST_DIR || '.next',
  productionBrowserSourceMaps: true,
  turbopack: {
    root: __dirname,
    // Replace native onnxruntime-node with onnxruntime-web (WASM) so the
    // in-process vector search runs in Cloud Run without native .so files.
    // The alias must be applied by the bundler, so neither package should be
    // in serverExternalPackages (external = loaded by Node.js, bypasses alias).
    resolveAlias: {
      'onnxruntime-node': 'onnxruntime-web',
    },
  },
  // Production webpack alias (Turbopack handles dev builds).
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'onnxruntime-node': 'onnxruntime-web',
    };
    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;
