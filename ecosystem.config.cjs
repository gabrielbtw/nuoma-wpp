module.exports = {
  // LEGACY V1 maintenance process map. Fase 1 keeps this file available for
  // rollback/reference only; use ecosystem.canonical.config.cjs for V2.
  apps: [
    {
      name: "web-app",
      cwd: "./",
      script: "npm",
      args: "run start --workspace @nuoma/web-app",
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "wa-worker",
      cwd: "./",
      script: "npm",
      args: "run start --workspace @nuoma/wa-worker",
      max_memory_restart: "900M",
      cron_restart: "0 4 * * *",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "scheduler",
      cwd: "./",
      script: "npm",
      args: "run start --workspace @nuoma/scheduler",
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
