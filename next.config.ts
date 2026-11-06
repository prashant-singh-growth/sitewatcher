import type { NextConfig } from 'next';
// pdfkit reads its bundled font files from disk at runtime, so it must not be bundled by webpack.
const nextConfig: NextConfig = { poweredByHeader: false, serverExternalPackages: ['pdfkit'] };
export default nextConfig;
