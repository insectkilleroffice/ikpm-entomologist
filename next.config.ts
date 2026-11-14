import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The portal is one page; old record URLs (e.g. links in notifications) open the drawer.
  async redirects() {
    return [
      ["jobs", "job"], ["complaints", "complaint"], ["requests", "request"], ["meetings", "meeting"], ["sites", "site"],
    ].map(([from, to]) => ({ source: `/${from}/:id`, destination: `/?open=${to}_:id`, permanent: false }));
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
