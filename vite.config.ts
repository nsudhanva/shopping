import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tailwindcss(),
    // Static site. The build prerenders "/" to HTML, and Firebase Hosting serves dist/client.
    tanstackStart({ prerender: { enabled: true, crawlLinks: false, failOnError: true } }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
