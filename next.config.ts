
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfkit'],

  outputFileTracingIncludes: {
    '/*': [
      './node_modules/pdfkit/**/*',
    ],
  },
};

export default nextConfig;
