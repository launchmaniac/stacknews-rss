// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

import { FETCH_CONFIG } from '../config.js';
import { FEEDS } from '../lib/constants.js';
import type { RSSItem, FeedConfig, FeedMeta } from '../lib/types.js';
import {
  getFeedData,
  setFeedData,
  getFeedMeta,
  setFeedMeta,
  setCategoryData,
  acquireRefreshLock,
  releaseRefreshLock,
} from './redis-cache.js';

// Parse RSS/Atom XML into items
function parseRSS(xml: string, feedConfig: FeedConfig): RSSItem[] {
  const items: RSSItem[] = [];

  // Determine if Atom or RSS
  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');

  if (isAtom) {
    // Parse Atom
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    let match;
    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];
      const title = extractTag(entry, 'title') || '';
      const link = extractAtomLink(entry) || '';
      const published = extractTag(entry, 'published') || extractTag(entry, 'updated') || '';
      const summary = extractTag(entry, 'summary') || extractTag(entry, 'content') || '';
      const author = extractTag(entry, 'name') || extractTag(entry, 'author') || '';
      const id = extractTag(entry, 'id') || link;

      if (title && link) {
        items.push({
          title: decodeEntities(title),
          link,
          pubDate: published,
          guid: id,
          author: decodeEntities(author),
          description: truncate(stripHtml(decodeEntities(summary)), 500),
          content: decodeEntities(summary),
          thumbnail: extractMediaThumbnail(entry) || '',
          enclosure: {},
          categories: extractCategories(entry),
          sourceName: feedConfig.name,
          color: feedConfig.color,
        });
      }
    }
  } else {
    // Parse RSS 2.0
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title = extractTag(item, 'title') || '';
      const rawLink = extractTag(item, 'link') || '';
      const guid = extractTag(item, 'guid') || '';
      // Use link if available, otherwise fall back to guid (some feeds only have guid)
      const link = rawLink || guid;
      const pubDate = extractTag(item, 'pubDate') || extractTag(item, 'dc:date') || '';
      const description = extractTag(item, 'description') || '';
      const content = extractTag(item, 'content:encoded') || description;
      const author = extractTag(item, 'author') || extractTag(item, 'dc:creator') || '';

      if (title && link) {
        items.push({
          title: decodeEntities(title),
          link,
          pubDate,
          guid: guid || link,
          author: decodeEntities(author),
          description: truncate(stripHtml(decodeEntities(description)), 500),
          content: decodeEntities(content),
          thumbnail: extractMediaThumbnail(item) || extractEnclosureImage(item) || '',
          enclosure: extractEnclosure(item),
          categories: extractCategories(item),
          sourceName: feedConfig.name,
          color: feedConfig.color,
        });
      }
    }
  }

  return items;
}

// Helper functions
function extractTag(xml: string, tag: string): string | null {
  // Match CDATA content (with optional whitespace) or plain content
  const regex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? (match[1] || match[2] || '').trim() : null;
}

function extractAtomLink(entry: string): string | null {
  const altMatch = entry.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (altMatch) return altMatch[1];
  const hrefMatch = entry.match(/<link[^>]*href=["']([^"']+)["']/i);
  return hrefMatch ? hrefMatch[1] : null;
}

function extractMediaThumbnail(item: string): string | null {
  const mediaMatch = item.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i);
  if (mediaMatch) return mediaMatch[1];
  const mediaContent = item.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*type=["']image/i);
  if (mediaContent) return mediaContent[1];
  return null;
}

function extractEnclosureImage(item: string): string | null {
  const encMatch = item.match(/<enclosure[^>]*type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/i);
  if (encMatch) return encMatch[1];
  const urlFirst = item.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image/i);
  return urlFirst ? urlFirst[1] : null;
}

function extractEnclosure(item: string): Record<string, unknown> {
  const match = item.match(/<enclosure([^>]*)\/?\s*>/i);
  if (!match) return {};
  const attrs = match[1];
  const url = attrs.match(/url=["']([^"']+)["']/i)?.[1];
  const type = attrs.match(/type=["']([^"']+)["']/i)?.[1];
  const length = attrs.match(/length=["']([^"']+)["']/i)?.[1];
  return { url, type, length };
}

function extractCategories(item: string): string[] {
  const categories: string[] = [];
  const catRegex = /<category[^>]*>([^<]+)<\/category>/gi;
  let match;
  while ((match = catRegex.exec(item)) !== null) {
    categories.push(decodeEntities(match[1].trim()));
  }
  return categories;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// Fetch a single feed with retry logic
async function fetchFeed(feedConfig: FeedConfig): Promise<RSSItem[]> {
  const meta = await getFeedMeta(feedConfig.id);
  const cachedData = await getFeedData(feedConfig.id);
  const headers: Record<string, string> = {
    'User-Agent': FETCH_CONFIG.USER_AGENT,
    'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
  };

  // Only add conditional headers if we have BOTH metadata AND cached data
  // This prevents 304 responses when cached data has expired
  if (cachedData && cachedData.length > 0) {
    if (meta?.etag) headers['If-None-Match'] = meta.etag;
    if (meta?.lastModified) headers['If-Modified-Since'] = meta.lastModified;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= FETCH_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_CONFIG.TIMEOUT_MS);

      const response = await fetch(feedConfig.url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // 304 Not Modified - use cached data (should always exist since we only send
      // conditional headers when cached data exists)
      if (response.status === 304) {
        if (cachedData && cachedData.length > 0) return cachedData;
        // This shouldn't happen, but handle gracefully
        throw new Error('HTTP 304 but no cached data');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xml = await response.text();
      const items = parseRSS(xml, feedConfig);

      // Update cache
      await setFeedData(feedConfig.id, items);
      await setFeedMeta(feedConfig.id, {
        etag: response.headers.get('ETag') || undefined,
        lastModified: response.headers.get('Last-Modified') || undefined,
        lastFetch: Date.now(),
      });

      return items;
    } catch (err) {
      lastError = err as Error;

      if (attempt < FETCH_CONFIG.MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, FETCH_CONFIG.RETRY_DELAY_MS * attempt));
        continue;
      }
    }
  }

  console.error(`[Feed] ${feedConfig.id} failed: ${lastError?.message}`);

  // Return cached data on failure
  const cached = await getFeedData(feedConfig.id);
  return cached || [];
}

// Fetch all feeds for a category
export async function fetchCategory(category: string): Promise<{
  feeds: Record<string, RSSItem[]>;
  stream: RSSItem[];
  errors: string[];
}> {
  // Try to acquire lock
  const hasLock = await acquireRefreshLock(category);
  if (!hasLock) {
    console.log(`[Fetch] Category ${category} is already being refreshed`);
    // Return empty - caller should use cached data
    return { feeds: {}, stream: [], errors: ['refresh_in_progress'] };
  }

  try {
    const categoryFeeds = FEEDS.filter((f) => f.category === category);
    const feeds: Record<string, RSSItem[]> = {};
    const errors: string[] = [];
    const allItems: RSSItem[] = [];

    // Limit concurrent requests per host
    const hostCounts = new Map<string, number>();
    const results = await Promise.allSettled(
      categoryFeeds.map(async (feedConfig) => {
        const host = new URL(feedConfig.url).host;
        const count = hostCounts.get(host) || 0;

        // Stagger requests to same host
        if (count > 0) {
          await new Promise((r) => setTimeout(r, count * 200));
        }
        hostCounts.set(host, count + 1);

        return { feedConfig, items: await fetchFeed(feedConfig) };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { feedConfig, items } = result.value;
        if (items.length > 0) {
          feeds[feedConfig.id] = items;
          allItems.push(...items);
        } else {
          errors.push(`${feedConfig.id}: no items`);
        }
      } else {
        errors.push(result.reason?.message || 'unknown error');
      }
    }

    // Sort stream by publication date (newest first)
    const stream = allItems
      .sort((a, b) => {
        const dateA = new Date(a.pubDate).getTime() || 0;
        const dateB = new Date(b.pubDate).getTime() || 0;
        return dateB - dateA;
      })
      .slice(0, 200); // Limit to 200 items

    // Cache the aggregate
    await setCategoryData(category, {
      feeds,
      stream,
      timestamp: new Date().toISOString(),
    });

    return { feeds, stream, errors };
  } finally {
    await releaseRefreshLock(category);
  }
}

// Get feeds for a category (from cache or fresh)
export async function getCategoryFeeds(
  category: string,
  forceRefresh = false
): Promise<{
  feeds: Record<string, RSSItem[]>;
  stream: RSSItem[];
  cached: boolean;
  errors?: string[];
}> {
  if (!forceRefresh) {
    const { getCategoryData } = await import('./redis-cache.js');
    const cached = await getCategoryData(category);
    if (cached) {
      return {
        feeds: cached.feeds,
        stream: cached.stream,
        cached: true,
      };
    }
  }

  const result = await fetchCategory(category);
  return {
    feeds: result.feeds,
    stream: result.stream,
    cached: false,
    errors: result.errors.length > 0 ? result.errors : undefined,
  };
}

// Get list of unique categories from feeds
export function getCategories(): string[] {
  const categories = new Set<string>();
  for (const feed of FEEDS) {
    categories.add(feed.category);
  }
  return Array.from(categories);
}

// Get feeds count per category
export function getCategoryFeedCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const feed of FEEDS) {
    counts[feed.category] = (counts[feed.category] || 0) + 1;
  }
  return counts;
}
