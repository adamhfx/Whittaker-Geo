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
        value: "https://geoflow-preview.roger-d-whittaker.workers.dev",
      },
      BILLING_ENABLED: { type: "text", value: "false" },
    },
  }),
});
