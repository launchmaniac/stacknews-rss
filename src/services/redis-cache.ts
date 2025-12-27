// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

import Redis from 'ioredis';
import { config, REDIS_PREFIX, CACHE_TTL } from '../config.js';
import type { RSSItem, CategoryData, FeedMeta } from '../lib/types.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }
  return redis;
}

export async function isRedisConnected(): Promise<boolean> {
  try {
    const client = getRedis();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

// Key builders with namespace prefix
const keys = {
  feedData: (feedId: string) => `${REDIS_PREFIX}feed:${feedId}:data`,
  feedMeta: (feedId: string) => `${REDIS_PREFIX}feed:${feedId}:meta`,
  categoryAggregate: (category: string) => `${REDIS_PREFIX}category:${category}:aggregate`,
  categoryStale: (category: string) => `${REDIS_PREFIX}category:${category}:stale`,
  categoryRefreshed: (category: string) => `${REDIS_PREFIX}category:${category}:refreshed`,
  refreshLock: (category: string) => `${REDIS_PREFIX}lock:${category}`,
  globalStream: () => `${REDIS_PREFIX}stream:global`,
};

// Feed data caching
export async function getFeedData(feedId: string): Promise<RSSItem[] | null> {
  try {
    const data = await getRedis().get(keys.feedData(feedId));
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`[Redis] getFeedData error for ${feedId}:`, err);
    return null;
  }
}

export async function setFeedData(feedId: string, items: RSSItem[]): Promise<void> {
  try {
    await getRedis().setex(
      keys.feedData(feedId),
      CACHE_TTL.FEED_DATA,
      JSON.stringify(items)
    );
  } catch (err) {
    console.error(`[Redis] setFeedData error for ${feedId}:`, err);
  }
}

// Feed metadata (ETag, Last-Modified)
export async function getFeedMeta(feedId: string): Promise<FeedMeta | null> {
  try {
    const data = await getRedis().get(keys.feedMeta(feedId));
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`[Redis] getFeedMeta error for ${feedId}:`, err);
    return null;
  }
}

export async function setFeedMeta(feedId: string, meta: FeedMeta): Promise<void> {
  try {
    await getRedis().setex(
      keys.feedMeta(feedId),
      CACHE_TTL.FEED_META,
      JSON.stringify(meta)
    );
  } catch (err) {
    console.error(`[Redis] setFeedMeta error for ${feedId}:`, err);
  }
}

// Category aggregate caching
export async function getCategoryData(category: string): Promise<CategoryData | null> {
  try {
    const data = await getRedis().get(keys.categoryAggregate(category));
    if (data) return JSON.parse(data);

    // Try stale fallback
    const stale = await getRedis().get(keys.categoryStale(category));
    if (stale) {
      console.log(`[Redis] Serving stale data for ${category}`);
      return { ...JSON.parse(stale), _stale: true };
    }

    return null;
  } catch (err) {
    console.error(`[Redis] getCategoryData error for ${category}:`, err);
    return null;
  }
}

export async function setCategoryData(category: string, data: CategoryData): Promise<void> {
  try {
    const ttl = CACHE_TTL.CATEGORY_OVERRIDES[category] || CACHE_TTL.CATEGORY_AGGREGATE;
    const json = JSON.stringify(data);

    // Set fresh cache with category-specific TTL
    await getRedis().setex(keys.categoryAggregate(category), ttl, json);

    // Set stale fallback with longer TTL
    await getRedis().setex(keys.categoryStale(category), CACHE_TTL.STALE_FALLBACK, json);

    // Update refresh timestamp
    await getRedis().set(keys.categoryRefreshed(category), Date.now().toString());
  } catch (err) {
    console.error(`[Redis] setCategoryData error for ${category}:`, err);
  }
}

// Get last refresh time for a category
export async function getCategoryRefreshTime(category: string): Promise<number> {
  try {
    const ts = await getRedis().get(keys.categoryRefreshed(category));
    return ts ? parseInt(ts, 10) : 0;
  } catch {
    return 0;
  }
}

// Global stream caching
export async function getGlobalStream(): Promise<RSSItem[] | null> {
  try {
    const data = await getRedis().get(keys.globalStream());
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('[Redis] getGlobalStream error:', err);
    return null;
  }
}

export async function setGlobalStream(items: RSSItem[]): Promise<void> {
  try {
    await getRedis().setex(
      keys.globalStream(),
      CACHE_TTL.GLOBAL_STREAM,
      JSON.stringify(items)
    );
  } catch (err) {
    console.error('[Redis] setGlobalStream error:', err);
  }
}

// Distributed locking for refresh operations
export async function acquireRefreshLock(category: string): Promise<boolean> {
  try {
    const result = await getRedis().set(
      keys.refreshLock(category),
      Date.now().toString(),
      'EX',
      CACHE_TTL.REFRESH_LOCK,
      'NX'
    );
    return result === 'OK';
  } catch (err) {
    console.error(`[Redis] acquireRefreshLock error for ${category}:`, err);
    return false;
  }
}

export async function releaseRefreshLock(category: string): Promise<void> {
  try {
    await getRedis().del(keys.refreshLock(category));
  } catch (err) {
    console.error(`[Redis] releaseRefreshLock error for ${category}:`, err);
  }
}

// Cache stats for health endpoint
export async function getCacheStats(): Promise<{ cached: number; total: number }> {
  try {
    const pattern = `${REDIS_PREFIX}category:*:aggregate`;
    const cachedKeys = await getRedis().keys(pattern);
    return {
      cached: cachedKeys.length,
      total: 23, // Known category count
    };
  } catch {
    return { cached: 0, total: 23 };
  }
}

// Cleanup on shutdown
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
