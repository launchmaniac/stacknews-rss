// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com
// Treasury Fiscal Data fetcher (Debt to the Penny, Avg Interest Rates, DTS Cash)

import { getRedis } from './redis-cache.js';
import { REDIS_PREFIX, CACHE_TTL, FETCH_CONFIG, config } from '../config.js';
import type { TreasuryFiscalSnapshot, DebtGrowthRate, YieldCurvePoint } from '../lib/types.js';

const TFD = {
  debt: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny',
  avgRates: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates',
  cash: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance'
};

// FRED series IDs for Treasury Constant Maturity rates
const FRED_SERIES = {
  bc_1month: 'DGS1MO',
  bc_3month: 'DGS3MO',
  bc_6month: 'DGS6MO',
  bc_1year: 'DGS1',
  bc_2year: 'DGS2',
  bc_5year: 'DGS5',
  bc_10year: 'DGS10',
  bc_30year: 'DGS30',
  spread_10y2y: 'T10Y2Y'
} as const;

// Redis keys
const keys = {
  treasuryFiscal: () => `${REDIS_PREFIX}treasury:fiscal`,
  treasuryFiscalStale: () => `${REDIS_PREFIX}treasury:fiscal:stale`,
  yieldCurve: (days: number) => `${REDIS_PREFIX}treasury:yieldcurve:${days}`,
  yieldCurveStale: (days: number) => `${REDIS_PREFIX}treasury:yieldcurve:${days}:stale`,
};

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': FETCH_CONFIG.USER_AGENT
      },
      signal: AbortSignal.timeout(FETCH_CONFIG.TIMEOUT_MS)
    });
    if (!res.ok) {
      console.log(`[Treasury] Fetch failed: ${res.status} ${res.statusText} for ${url.split('?')[0]}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.log(`[Treasury] Fetch error: ${err?.message || 'Unknown'} for ${url.split('?')[0]}`);
    return null;
  }
}

function calculateDebtGrowthRate(debtHistory: { date: string; value: number }[]): DebtGrowthRate | undefined {
  if (debtHistory.length < 2) return undefined;

  const sorted = [...debtHistory].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];

  const oldestDate = new Date(oldest.date);
  const newestDate = new Date(newest.date);
  const daysDiff = (newestDate.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysDiff < 1) return undefined;

  const totalGrowth = newest.value - oldest.value;
  const dailyAverage = totalGrowth / daysDiff;
  const perSecond = dailyAverage / 86400;

  return {
    dailyAverage: Math.round(dailyAverage),
    perSecond: Math.round(perSecond * 100) / 100,
    periodStart: oldest.date,
    periodEnd: newest.date,
    totalGrowth: Math.round(totalGrowth),
    daysInPeriod: Math.round(daysDiff)
  };
}

export async function getTreasuryFiscalSnapshot(
  limitDebt: number = 100,
  limitRates: number = 13,
  limitCash: number = 60
): Promise<TreasuryFiscalSnapshot> {
  const qs = (p: Record<string, string | number>) =>
    '?' + Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');

  const debtUrl = TFD.debt + qs({ sort: '-record_date', format: 'json', 'page[size]': limitDebt });
  const rateUrl = TFD.avgRates + qs({ sort: '-record_date', format: 'json', 'page[size]': limitRates });
  const cashUrl = TFD.cash + qs({ sort: '-record_date', format: 'json', 'page[size]': limitCash });

  const [debtJson, rateJson, cashJson] = await Promise.all([
    fetchJson(debtUrl),
    fetchJson(rateUrl),
    fetchJson(cashUrl)
  ]);

  const snapshot: TreasuryFiscalSnapshot = {
    debt: 0,
    debtTimestamp: undefined,
    debtHistory: [],
    debtGrowthRate: undefined,
    avgInterestRate: 0,
    rateHistory: [],
    cash: 0,
    cashHistory: []
  };

  if (Array.isArray(debtJson?.data)) {
    const series = debtJson.data
      .map((d: any) => ({ date: d.record_date, value: parseFloat(d.tot_pub_debt_out_amt) }))
      .filter((p: any) => p.date && !isNaN(p.value) && p.value > 0);
    snapshot.debtHistory = series.slice().reverse();
    if (series[0]) {
      snapshot.debt = series[0].value;
      snapshot.debtTimestamp = series[0].date + 'T00:00:00Z';
    }
    snapshot.debtGrowthRate = calculateDebtGrowthRate(snapshot.debtHistory);
  }

  if (Array.isArray(rateJson?.data)) {
    const series = rateJson.data
      .map((d: any) => ({ date: d.record_date, value: parseFloat(d.avg_interest_rate_amt) }))
      .filter((p: any) => p.date && !isNaN(p.value));
    snapshot.rateHistory = series.slice().reverse();
    if (series[0]) snapshot.avgInterestRate = series[0].value;
  }

  if (Array.isArray(cashJson?.data)) {
    const series = cashJson.data
      .map((d: any) => ({ date: d.record_date || d.transaction_dt, value: parseFloat(d.open_today_bal) }))
      .filter((p: { date: string; value: number }) => p.date && !isNaN(p.value));
    snapshot.cashHistory = series.slice().reverse().map((p: { date: string; value: number }) => ({ date: p.date, value: p.value * 1_000_000 }));
    if (series[0]) snapshot.cash = series[0].value * 1_000_000;
  }

  return snapshot;
}

// Get cached Treasury fiscal data or fetch fresh
export async function getCachedTreasuryFiscal(): Promise<{ data: TreasuryFiscalSnapshot; cached: boolean; stale?: boolean }> {
  const redis = getRedis();

  try {
    // Check fresh cache
    const cached = await redis.get(keys.treasuryFiscal());
    if (cached) {
      return { data: JSON.parse(cached), cached: true };
    }

    // Check stale cache
    const stale = await redis.get(keys.treasuryFiscalStale());
    if (stale) {
      // Fetch fresh in background
      fetchAndCacheTreasuryFiscal().catch(console.error);
      return { data: JSON.parse(stale), cached: true, stale: true };
    }
  } catch (err) {
    console.error('[Treasury] Cache read error:', err);
  }

  // Fetch fresh
  const data = await fetchAndCacheTreasuryFiscal();
  return { data, cached: false };
}

async function fetchAndCacheTreasuryFiscal(): Promise<TreasuryFiscalSnapshot> {
  const data = await getTreasuryFiscalSnapshot();
  const redis = getRedis();

  try {
    const json = JSON.stringify(data);
    await redis.setex(keys.treasuryFiscal(), CACHE_TTL.TREASURY_FISCAL, json);
    await redis.setex(keys.treasuryFiscalStale(), CACHE_TTL.STALE_FALLBACK, json);
  } catch (err) {
    console.error('[Treasury] Cache write error:', err);
  }

  return data;
}

// FRED API for Yield Curve
async function fetchFredSeries(
  seriesId: string,
  apiKey: string,
  limit: number
): Promise<{ date: string; value: number }[]> {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_CONFIG.TIMEOUT_MS)
    });
    if (res.ok) {
      const json = await res.json() as { observations?: Array<{ date: string; value: string }> };
      const observations = json?.observations || [];
      return observations
        .filter((o) => o.value !== '.' && !isNaN(parseFloat(o.value)))
        .map((o) => ({
          date: o.date,
          value: parseFloat(o.value)
        }));
    }
    console.error(`[FRED ${seriesId}] HTTP ${res.status}`);
  } catch (err: any) {
    console.error(`[FRED ${seriesId}] Failed: ${err?.message || err}`);
  }
  return [];
}

export async function fetchYieldCurve(days: number = 60): Promise<YieldCurvePoint[]> {
  const apiKey = config.fredApiKey;
  if (!apiKey) {
    console.error('[YieldCurve] FRED_API_KEY not configured');
    return [];
  }

  const limit = Math.max(1, Math.min(days, 365));

  const [m1Data, m3Data, m6Data, y1Data, y2Data, y5Data, y10Data, y30Data, spreadData] = await Promise.all([
    fetchFredSeries(FRED_SERIES.bc_1month, apiKey, limit),
    fetchFredSeries(FRED_SERIES.bc_3month, apiKey, limit),
    fetchFredSeries(FRED_SERIES.bc_6month, apiKey, limit),
    fetchFredSeries(FRED_SERIES.bc_1year, apiKey, limit),
    fetchFredSeries(FRED_SERIES.bc_2year, apiKey, limit),
    fetchFredSeries(FRED_SERIES.bc_5year, apiKey, limit),
    fetchFredSeries(FRED_SERIES.bc_10year, apiKey, limit),
    fetchFredSeries(FRED_SERIES.bc_30year, apiKey, limit),
    fetchFredSeries(FRED_SERIES.spread_10y2y, apiKey, limit)
  ]);

  const toMap = (arr: { date: string; value: number }[]) =>
    new Map(arr.map((d) => [d.date, d.value]));

  const m1Map = toMap(m1Data);
  const m3Map = toMap(m3Data);
  const m6Map = toMap(m6Data);
  const y1Map = toMap(y1Data);
  const y2Map = toMap(y2Data);
  const y5Map = toMap(y5Data);
  const y10Map = toMap(y10Data);
  const y30Map = toMap(y30Data);
  const spreadMap = toMap(spreadData);

  const allDates = new Set<string>();
  [m1Data, m3Data, m6Data, y1Data, y2Data, y5Data, y10Data, y30Data, spreadData].forEach(
    (arr) => arr.forEach((d) => allDates.add(d.date))
  );

  const sortedDates = Array.from(allDates)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  const points: YieldCurvePoint[] = sortedDates.map((date) => ({
    date,
    bc_1month: m1Map.get(date),
    bc_3month: m3Map.get(date),
    bc_6month: m6Map.get(date),
    bc_1year: y1Map.get(date),
    bc_2year: y2Map.get(date),
    bc_5year: y5Map.get(date),
    bc_10year: y10Map.get(date),
    bc_30year: y30Map.get(date),
    spread_10y2y: spreadMap.get(date)
  }));

  const validPoints = points.filter(p =>
    p.bc_2year !== undefined || p.bc_10year !== undefined
  );

  return validPoints.reverse();
}

// Get cached yield curve data or fetch fresh
export async function getCachedYieldCurve(days: number = 60): Promise<{ data: YieldCurvePoint[]; cached: boolean; stale?: boolean }> {
  const redis = getRedis();

  try {
    const cached = await redis.get(keys.yieldCurve(days));
    if (cached) {
      return { data: JSON.parse(cached), cached: true };
    }

    const stale = await redis.get(keys.yieldCurveStale(days));
    if (stale) {
      fetchAndCacheYieldCurve(days).catch(console.error);
      return { data: JSON.parse(stale), cached: true, stale: true };
    }
  } catch (err) {
    console.error('[YieldCurve] Cache read error:', err);
  }

  const data = await fetchAndCacheYieldCurve(days);
  return { data, cached: false };
}

async function fetchAndCacheYieldCurve(days: number): Promise<YieldCurvePoint[]> {
  const data = await fetchYieldCurve(days);
  const redis = getRedis();

  try {
    const json = JSON.stringify(data);
    await redis.setex(keys.yieldCurve(days), CACHE_TTL.YIELD_CURVE, json);
    await redis.setex(keys.yieldCurveStale(days), CACHE_TTL.STALE_FALLBACK, json);
  } catch (err) {
    console.error('[YieldCurve] Cache write error:', err);
  }

  return data;
}
