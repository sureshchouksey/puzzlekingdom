import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    // Bind to all network interfaces (0.0.0.0), not just localhost, so
    // other devices on the same Wi-Fi network (an iPad, a phone) can open
    // this dev server at this machine's local IP - e.g. http://192.168.1.23:5173.
    // The /api proxy below still resolves "localhost:3001" from this
    // machine's own point of view, since the proxying happens inside this
    // Vite process, not in the connecting device's browser - so no change
    // is needed there for LAN access to work.
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
