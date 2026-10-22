import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  accountId: "032b3907437b929309a3bb9c45964a13",
  worker: defineWorker({
    name: "geoflow-preview",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-22",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: true,
    observability: {
      enabled: true,
      headSamplingRate: 1,
      redactQueryString: true,
    },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      APP_URL: {
        type: "text",
        value: "https://whittakergeo.com",
      },
      NEXT_PUBLIC_SUPABASE_URL: bindings.text("https://mkjlxkctrtqcvxucuzcs.supabase.co"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: bindings.text("sb_publishable_tMTYs8cmQMMWO5L3WsGGeg_NkJy-2b1"),
      SUPABASE_URL: bindings.text("https://mkjlxkctrtqcvxucuzcs.supabase.co"),
      // Set the value in Cloudflare Secrets; never put it in source or build env.
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      BILLING_ENABLED: { type: "text", value: "false" },
    },
  }),
});
