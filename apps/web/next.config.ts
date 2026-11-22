import type { NextConfig } from "next";

// Version affichée en bas de page, à reporter dans le cahier de recette.
const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "";
const branch = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.GITHUB_HEAD_REF ?? "";
const version = sha ? `${branch ? branch + "@" : ""}${sha.slice(0, 7)}` : "locale";

const nextConfig: NextConfig = {
  transpilePackages: ["@pod-stud/shared"],
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
