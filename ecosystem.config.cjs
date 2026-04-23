module.exports = {
  apps: [
    {
      name: 'qishu',
      cwd: __dirname,
      script: '.next/standalone/server.js',
      interpreter: 'node',
      node_args: '--max-old-space-size=384',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '450M',
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
      },
    },
  ],
};
