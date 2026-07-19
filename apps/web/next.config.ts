import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
