/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  webpack(config, { dev }) {
    // SQLite writes to data/ on every agent message; if the dev watcher sees them it
    // recompiles and can reload the page mid-run.
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/data/**", "**/scratch/**"],
      };
    }
    return config;
  },
};
export default nextConfig;
