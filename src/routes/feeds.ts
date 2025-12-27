// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

import { Hono } from 'hono';
import { getCategoryFeeds, getCategories, getCategoryFeedCounts } from '../services/feed-fetcher.js';
import { getCategoryData, getCategoryRefreshTime } from '../services/redis-cache.js';
import type { FeedsResponse, RSSItem } from '../lib/types.js';

const feeds = new Hono();

// GET /api/feeds - Get feeds for a category
feeds.get('/', async (c) => {
  const category = c.req.query('category') || 'ALL';
  const refresh = c.req.query('refresh') === 'true';
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 500);

  try {
    if (category === 'ALL') {
      // Aggregate all categories
      const allCategories = getCategories();
      const feeds: Record<string, RSSItem[]> = {};
      const allItems: RSSItem[] = [];
      let cachedCount = 0;

      for (const cat of allCategories) {
        const data = await getCategoryData(cat);
        if (data) {
          Object.assign(feeds, data.feeds);
          allItems.push(...data.stream);
          cachedCount++;
        }
      }

      // Sort and dedupe stream
      const seen = new Set<string>();
      const stream = allItems
        .sort((a, b) => {
          const dateA = new Date(a.pubDate).getTime() || 0;
          const dateB = new Date(b.pubDate).getTime() || 0;
          return dateB - dateA;
        })
        .filter((item) => {
          if (seen.has(item.guid)) return false;
          seen.add(item.guid);
          return true;
        })
        .slice(0, limit);

      const response: FeedsResponse = {
        feeds,
        stream,
        _meta: {
          category: 'ALL',
          cached: cachedCount > 0,
          cacheAge: 0,
          totalFeeds: Object.keys(feeds).length,
          timestamp: new Date().toISOString(),
        },
      };

      return c.json(response);
    }

    // Single category
    const result = await getCategoryFeeds(category, refresh);
    const lastRefresh = await getCategoryRefreshTime(category);
    const cacheAge = lastRefresh > 0 ? Math.floor((Date.now() - lastRefresh) / 1000) : 0;

    const response: FeedsResponse = {
      feeds: result.feeds,
      stream: result.stream.slice(0, limit),
      errors: result.errors,
      _meta: {
        category,
        cached: result.cached,
        cacheAge,
        totalFeeds: Object.keys(result.feeds).length,
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (err) {
    console.error('[API] /api/feeds error:', err);
    return c.json(
      {
        feeds: {},
        stream: [],
        errors: [(err as Error).message],
        _meta: {
          category,
          cached: false,
          cacheAge: 0,
          totalFeeds: 0,
          timestamp: new Date().toISOString(),
        },
      },
      500
    );
  }
});

// GET /api/feeds/categories - List all categories with feed counts
feeds.get('/categories', async (c) => {
  const counts = getCategoryFeedCounts();
  const categories = getCategories();

  return c.json({
    categories: categories.map((cat) => ({
      id: cat,
      feedCount: counts[cat] || 0,
    })),
    total: categories.length,
  });
});

// GET /api/feeds/stream - Get global stream (all items sorted)
feeds.get('/stream', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500);
  const allCategories = getCategories();
  const allItems: RSSItem[] = [];

  for (const cat of allCategories) {
    const data = await getCategoryData(cat);
    if (data?.stream) {
      allItems.push(...data.stream);
    }
  }

  // Sort, dedupe, limit
  const seen = new Set<string>();
  const stream = allItems
    .sort((a, b) => {
      const dateA = new Date(a.pubDate).getTime() || 0;
      const dateB = new Date(b.pubDate).getTime() || 0;
      return dateB - dateA;
    })
    .filter((item) => {
      if (seen.has(item.guid)) return false;
      seen.add(item.guid);
      return true;
    })
    .slice(0, limit);

  return c.json({
    stream,
    count: stream.length,
    timestamp: new Date().toISOString(),
  });
});

export default feeds;
