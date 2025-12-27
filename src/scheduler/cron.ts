// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

import { Cron } from 'croner';
import {
  getNextCategoryToRefresh,
  refreshCategory,
  getStaleCategories,
  warmAllCategories,
} from '../services/coordinator.js';

let isInitialized = false;
const jobs: Cron[] = [];

export function initScheduler(): void {
  if (isInitialized) {
    console.log('[Scheduler] Already initialized');
    return;
  }

  console.log('[Scheduler] Initializing background jobs...');

  // Every 30 seconds: Refresh the next stale category
  const refreshJob = new Cron('*/30 * * * * *', async () => {
    try {
      const category = await getNextCategoryToRefresh();
      if (category) {
        await refreshCategory(category);
      }
    } catch (err) {
      console.error('[Scheduler] Refresh job error:', err);
    }
  });
  jobs.push(refreshJob);

  // Every 5 minutes: Log stale category status
  const statusJob = new Cron('*/5 * * * *', async () => {
    try {
      const stale = await getStaleCategories();
      if (stale.length > 0) {
        console.log(`[Scheduler] ${stale.length} stale categories: ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? '...' : ''}`);
      } else {
        console.log('[Scheduler] All categories fresh');
      }
    } catch (err) {
      console.error('[Scheduler] Status job error:', err);
    }
  });
  jobs.push(statusJob);

  // Daily at 3 AM UTC: Full cache warm
  const dailyWarmJob = new Cron('0 3 * * *', async () => {
    console.log('[Scheduler] Daily cache warm starting...');
    try {
      await warmAllCategories();
    } catch (err) {
      console.error('[Scheduler] Daily warm error:', err);
    }
  });
  jobs.push(dailyWarmJob);

  isInitialized = true;
  console.log('[Scheduler] Background jobs initialized');
}

export function stopScheduler(): void {
  console.log('[Scheduler] Stopping background jobs...');
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
  isInitialized = false;
  console.log('[Scheduler] Background jobs stopped');
}

// Start initial warm after a short delay
export async function startInitialWarm(delayMs = 5000): Promise<void> {
  console.log(`[Scheduler] Starting initial warm in ${delayMs}ms...`);
  await new Promise((r) => setTimeout(r, delayMs));

  try {
    // Warm primary categories first
    const primaryCategories = [
      'TREASURY',
      'FEDERAL RESERVE',
      'NEWS',
      'EXECUTIVE',
      'US CONGRESS',
    ];

    for (const category of primaryCategories) {
      await refreshCategory(category);
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log('[Scheduler] Initial primary categories warmed');
  } catch (err) {
    console.error('[Scheduler] Initial warm error:', err);
  }
}
