// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/0',
  apiSecret: process.env.API_SECRET || '',
  corsOrigin: process.env.CORS_ORIGIN || 'https://stacknews.org',
} as const;

export const REDIS_PREFIX = 'stacknews:';

export const CACHE_TTL = {
  // Per-feed data caching
  FEED_DATA: 10 * 60,           // 10 minutes
  FEED_META: 12 * 60 * 60,      // 12 hours for ETag/Last-Modified

  // Category aggregates
  CATEGORY_AGGREGATE: 5 * 60,   // 5 minutes default

  // Global stream
  GLOBAL_STREAM: 2 * 60,        // 2 minutes

  // Stale fallback
  STALE_FALLBACK: 60 * 60,      // 1 hour

  // Refresh locks
  REFRESH_LOCK: 60,             // 1 minute

  // Per-category overrides (in seconds)
  CATEGORY_OVERRIDES: {
    'TREASURY': 30 * 60,
    'FEDERAL RESERVE': 30 * 60,
    'NEWS': 3 * 60,
    'CRYPTO': 3 * 60,
    'EXECUTIVE': 5 * 60,
    'US CONGRESS': 10 * 60,
  } as Record<string, number>,
} as const;

export const FETCH_CONFIG = {
  TIMEOUT_MS: 8000,
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 500,
  BATCH_SIZE: 15,
  PER_HOST_CONCURRENCY: 3,
  USER_AGENT: 'StackNews/2.0 (+https://stacknews.org)',
} as const;
