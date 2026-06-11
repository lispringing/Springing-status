import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleGetMonitors } from "./server/getMonitors.js";

const apiPlugin = () => ({
  name: "local-api",
  configureServer(server) {
    server.middlewares.use("/api/getMonitors", (req, res) => {
      handleGetMonitors(req, res);
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  return {
    plugins: [react(), apiPlugin()],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
    build: {
      minify: "terser",
      terserOptions: {
        compress: {
          pure_funcs: ["console.log"],
        },
      },
      sourcemap: false,
    },
  };
});
