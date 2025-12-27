// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com

export interface RSSItem {
  title: string;
  pubDate: string;
  link: string;
  guid: string;
  author: string;
  thumbnail: string;
  description: string;
  content: string;
  enclosure?: Record<string, unknown>;
  categories: string[];
  sourceName?: string;
  color?: string;
}

export interface FeedConfig {
  id: string;
  url: string;
  name: string;
  color: string;
  category: string;
}

export interface FeedMeta {
  etag?: string;
  lastModified?: string;
  lastFetch: number;
}

export interface CategoryData {
  feeds: Record<string, RSSItem[]>;
  stream: RSSItem[];
  timestamp: string;
  _stale?: boolean;
}

export interface FeedsResponse {
  feeds: Record<string, RSSItem[]>;
  stream: RSSItem[];
  errors?: string[];
  _meta: {
    category: string;
    cached: boolean;
    cacheAge: number;
    totalFeeds: number;
    timestamp: string;
  };
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  redis: 'connected' | 'disconnected';
  lastRefresh: string | null;
  categoriesRefreshed: number;
  feeds: {
    total: number;
    cached: number;
    stale: number;
  };
}

// Treasury Fiscal Data Types
export interface DebtGrowthRate {
  dailyAverage: number;
  perSecond: number;
  periodStart: string;
  periodEnd: string;
  totalGrowth: number;
  daysInPeriod: number;
}

export interface TreasuryFiscalSnapshot {
  debt: number;
  debtTimestamp?: string;
  debtHistory: { date: string; value: number }[];
  debtGrowthRate?: DebtGrowthRate;
  avgInterestRate: number;
  rateHistory: { date: string; value: number }[];
  cash: number;
  cashHistory: { date: string; value: number }[];
}

// Yield Curve Types
export interface YieldCurvePoint {
  date: string;
  bc_1month?: number;
  bc_3month?: number;
  bc_6month?: number;
  bc_1year?: number;
  bc_2year?: number;
  bc_5year?: number;
  bc_10year?: number;
  bc_30year?: number;
  spread_10y2y?: number;
}
