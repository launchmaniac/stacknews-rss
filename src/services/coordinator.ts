// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

import { CACHE_TTL } from '../config.js';
import { getCategories, fetchCategory } from './feed-fetcher.js';
import { getCategoryRefreshTime, getCategoryData } from './redis-cache.js';

// Primary categories to rotate (most important)
const PRIMARY_CATEGORIES = [
  'TREASURY',
  'FEDERAL RESERVE',
  'EXECUTIVE',
  'US CONGRESS',
  'NEWS',
  'CRYPTO',
  'GLOBAL_MACRO',
  'ENERGY',
  'STATE_DEPT',
  'MILITARY',
];

// Track refresh state in memory (supplementing Redis)
const lastRefreshTimes = new Map<string, number>();
let lastRefreshedCategory: string | null = null;

export async function getNextCategoryToRefresh(): Promise<string | null> {
  const allCategories = getCategories();
  let oldest: string | null = null;
  let oldestTime = Infinity;

  for (const category of allCategories) {
    const lastRefresh = await getCategoryRefreshTime(category);
    const memoryTime = lastRefreshTimes.get(category) || 0;
    const effectiveTime = Math.max(lastRefresh, memoryTime);

    const ttl = CACHE_TTL.CATEGORY_OVERRIDES[category] || CACHE_TTL.CATEGORY_AGGREGATE;
    const isStale = Date.now() - effectiveTime > ttl * 1000;

    // Prioritize primary categories
    const isPrimary = PRIMARY_CATEGORIES.includes(category);
    const priority = isPrimary ? 0 : 1;

    if (isStale && effectiveTime < oldestTime - priority * 60000) {
      oldestTime = effectiveTime;
      oldest = category;
    }
  }

  return oldest;
}

export async function refreshCategory(category: string): Promise<boolean> {
  console.log(`[Coordinator] Refreshing category: ${category}`);
  const startTime = Date.now();

  try {
    const result = await fetchCategory(category);
    const duration = Date.now() - startTime;

    lastRefreshTimes.set(category, Date.now());
    lastRefreshedCategory = category;

    const feedCount = Object.keys(result.feeds).length;
    const itemCount = result.stream.length;

    console.log(
      `[Coordinator] ${category} refreshed in ${duration}ms: ${feedCount} feeds, ${itemCount} items`
    );

    return true;
  } catch (err) {
    console.error(`[Coordinator] Failed to refresh ${category}:`, err);
    return false;
  }
}

export async function getStaleCategories(): Promise<string[]> {
  const allCategories = getCategories();
  const stale: string[] = [];

  for (const category of allCategories) {
    const lastRefresh = await getCategoryRefreshTime(category);
    const ttl = CACHE_TTL.CATEGORY_OVERRIDES[category] || CACHE_TTL.CATEGORY_AGGREGATE;

    if (Date.now() - lastRefresh > ttl * 1000) {
      stale.push(category);
    }
  }

  return stale;
}

export async function getCachedCategoriesCount(): Promise<number> {
  const allCategories = getCategories();
  let count = 0;

  for (const category of allCategories) {
    const data = await getCategoryData(category);
    if (data && !data._stale) {
      count++;
    }
  }

  return count;
}

export function getLastRefreshedCategory(): string | null {
  return lastRefreshedCategory;
}

// Warm all categories (for initial startup or daily refresh)
export async function warmAllCategories(): Promise<void> {
  console.log('[Coordinator] Starting full cache warm...');
  const allCategories = getCategories();
  let success = 0;
  let failed = 0;

  for (const category of allCategories) {
    const result = await refreshCategory(category);
    if (result) {
      success++;
    } else {
      failed++;
    }

    // Small delay between categories to avoid overwhelming sources
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`[Coordinator] Cache warm complete: ${success} success, ${failed} failed`);
}
