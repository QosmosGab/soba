import type { NextConfig } from "next";

// Cache Components stay off: every panel page reads the database per request.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
