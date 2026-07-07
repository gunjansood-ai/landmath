import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow overriding the build dir (used by sandboxed builds where the default
  // .next dir sits on a FUSE mount that can't unlink hidden files). Defaults
  // to .next everywhere else — no effect on Vercel.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
