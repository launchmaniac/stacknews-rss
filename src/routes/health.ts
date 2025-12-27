// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

import { Hono } from 'hono';
import { isRedisConnected, getCacheStats } from '../services/redis-cache.js';
import { getCachedCategoriesCount, getLastRefreshedCategory, getStaleCategories, warmAllCategories } from '../services/coordinator.js';
import type { HealthResponse } from '../lib/types.js';

const health = new Hono();

const startTime = Date.now();
const VERSION = '1.0.0';

// GET /health - Basic health check
health.get('/', async (c) => {
  const redisOk = await isRedisConnected();
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const response: HealthResponse = {
    status: redisOk ? 'healthy' : 'degraded',
    version: VERSION,
    uptime,
    redis: redisOk ? 'connected' : 'disconnected',
    lastRefresh: getLastRefreshedCategory(),
    categoriesRefreshed: await getCachedCategoriesCount(),
    feeds: await getCacheStats(),
  };

  const statusCode = redisOk ? 200 : 503;
  return c.json(response, statusCode);
});

// GET /ready - Readiness probe (for k8s/docker)
health.get('/ready', async (c) => {
  const redisOk = await isRedisConnected();
  const cachedCategories = await getCachedCategoriesCount();

  // Ready if Redis is connected and at least some categories are cached
  const isReady = redisOk && cachedCategories > 0;

  if (isReady) {
    return c.json({ ready: true, cachedCategories });
  }

  return c.json(
    {
      ready: false,
      reason: !redisOk ? 'redis_disconnected' : 'no_cached_data',
      cachedCategories,
    },
    503
  );
});

// POST /warm - Trigger full cache warm (requires API key in query param)
health.post('/warm', async (c) => {
  const apiKey = c.req.query('key');
  const expectedKey = process.env.API_SECRET;

  if (!expectedKey || apiKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Run warm in background, don't block response
  warmAllCategories().catch(console.error);

  return c.json({
    message: 'Cache warm started',
    note: 'Check /health for progress'
  });
});

// GET /metrics - Basic metrics (Prometheus-compatible)
health.get('/metrics', async (c) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const redisOk = await isRedisConnected();
  const cacheStats = await getCacheStats();
  const staleCategories = await getStaleCategories();

  const metrics = [
    `# HELP stacknews_uptime_seconds Time since service start`,
    `# TYPE stacknews_uptime_seconds gauge`,
    `stacknews_uptime_seconds ${uptime}`,
    ``,
    `# HELP stacknews_redis_connected Whether Redis is connected`,
    `# TYPE stacknews_redis_connected gauge`,
    `stacknews_redis_connected ${redisOk ? 1 : 0}`,
    ``,
    `# HELP stacknews_categories_cached Number of cached categories`,
    `# TYPE stacknews_categories_cached gauge`,
    `stacknews_categories_cached ${cacheStats.cached}`,
    ``,
    `# HELP stacknews_categories_total Total number of categories`,
    `# TYPE stacknews_categories_total gauge`,
    `stacknews_categories_total ${cacheStats.total}`,
    ``,
    `# HELP stacknews_categories_stale Number of stale categories`,
    `# TYPE stacknews_categories_stale gauge`,
    `stacknews_categories_stale ${staleCategories.length}`,
  ].join('\n');

  return c.text(metrics, 200, {
    'Content-Type': 'text/plain; version=0.0.4',
  });
});

export default health;
