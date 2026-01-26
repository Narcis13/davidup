/**
 * Node.js server for the GameMotion API.
 * Starts the Hono app with graceful shutdown support.
 */

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Start the HTTP server.
 */
const server = serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running on http://localhost:${PORT}`);

/**
 * Graceful shutdown handler.
 * Closes the server and exits cleanly on SIGTERM.
 */
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

/**
 * Handle SIGINT (Ctrl+C) for development convenience.
 */
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
