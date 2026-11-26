import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["*.preview.studio.arc.io"],
  experimental: {
    serverActions: {
      bodySizeLimit: "3mb", // admin ad-creative uploads (max 2 MB)
      // Development only: GitHub Codespaces forwards requests with an Origin of localhost:3000 while the
      // forwarded host is *.app.github.dev, which Next.js rejects. Production keeps the strict same-origin check.
      ...(process.env.NODE_ENV === "production" ? {} : { allowedOrigins: ["localhost:3000", "*.app.github.dev"] }),
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Framing is only allowed in development so the Arc Studio preview iframe can load the app.
          ...(process.env.NODE_ENV === "production" ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera and microphone are needed for the in-browser video recorder
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
