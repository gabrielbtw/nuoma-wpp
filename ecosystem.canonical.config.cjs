module.exports = {
  apps: [
    {
      name: "nuoma-api",
      cwd: "./",
      script: "npm",
      args: "run start --workspace @nuoma/api",
      max_memory_restart: "700M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "nuoma-web",
      cwd: "./",
      script: "npm",
      args: "run start --workspace @nuoma/web",
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "nuoma-worker",
      cwd: "./",
      script: "npm",
      args: "run start --workspace @nuoma/worker",
      max_memory_restart: "1200M",
      cron_restart: "0 4 * * *",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
