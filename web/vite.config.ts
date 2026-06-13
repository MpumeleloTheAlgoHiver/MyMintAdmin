import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// During local dev, set VITE_API_BASE in web/.env.local to the deployed CRM URL
// (e.g. https://your-crm.vercel.app) so /api/* calls hit the real serverless
// functions. When the React app is deployed on the same origin as the api/
// functions, leave it unset and /api/* resolves relatively.
const API_BASE = process.env.VITE_API_BASE || "";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    proxy: API_BASE
      ? { "/api": { target: API_BASE, changeOrigin: true, secure: true } }
      : undefined,
  },
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
