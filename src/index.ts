// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { bearerAuth } from 'hono/bearer-auth';

import { config } from './config.js';
import { getRedis, closeRedis } from './services/redis-cache.js';
import { initScheduler, stopScheduler, startInitialWarm } from './scheduler/cron.js';

import feedsRoute from './routes/feeds.js';
import healthRoute from './routes/health.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: config.corsOrigin,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    maxAge: 86400,
  })
);

// Public routes (no auth)
app.route('/health', healthRoute);

// Protected routes (require API key)
app.use('/api/*', async (c, next) => {
  // Skip auth in development
  if (config.nodeEnv === 'development') {
    return next();
  }

  // Require API secret in production
  if (!config.apiSecret) {
    console.error('[Auth] API_SECRET not configured');
    return c.json({ error: 'Server configuration error' }, 500);
  }

  const auth = bearerAuth({ token: config.apiSecret });
  return auth(c, next);
});

app.route('/api/feeds', feedsRoute);

// Root route
app.get('/', (c) => {
  return c.json({
    service: 'stacknews-rss',
    version: '1.0.0',
    endpoints: {
      feeds: '/api/feeds?category=TREASURY',
      categories: '/api/feeds/categories',
      stream: '/api/feeds/stream',
      health: '/health',
      ready: '/health/ready',
      metrics: '/health/metrics',
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('[Error]', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Graceful shutdown
async function shutdown() {
  console.log('[Shutdown] Received shutdown signal');
  stopScheduler();
  await closeRedis();
  console.log('[Shutdown] Cleanup complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
async function main() {
  console.log(`[Server] Starting stacknews-rss...`);
  console.log(`[Server] Environment: ${config.nodeEnv}`);
  console.log(`[Server] Redis URL: ${config.redisUrl.replace(/\/\/.*@/, '//*****@')}`);

  // Connect to Redis
  try {
    const redis = getRedis();
    await redis.ping();
    console.log('[Server] Redis connected');
  } catch (err) {
    console.error('[Server] Redis connection failed:', err);
    process.exit(1);
  }

  // Initialize background scheduler
  initScheduler();

  // Start initial cache warm (async, don't block startup)
  startInitialWarm(3000).catch(console.error);

  // Start HTTP server
  serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.log(`[Server] Listening on http://localhost:${info.port}`);
    }
  );
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
