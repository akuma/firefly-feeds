import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vinext(),
    // Runs the RSC and SSR environments in workerd locally, so `bun run dev`
    // matches what actually serves the site. Do not register
    // `@vitejs/plugin-rsc` here — vinext does it, and a second one fails the
    // build with "Duplicate @vitejs/plugin-rsc detected".
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
});
