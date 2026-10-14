module.exports = {
  apps: [
    {
      name: 'ticketassist-worker',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      exp_backoff_restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        HEADLESS: 'true',
      },
      kill_timeout: 10000,
      listen_timeout: 10000,
      error_file: 'logs/worker-error.log',
      out_file: 'logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
