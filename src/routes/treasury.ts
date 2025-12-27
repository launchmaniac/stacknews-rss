// Product of Launch Maniac llc, Las Vegas, Nevada - (725) 444-8200  support@launchmaniac.com
// Treasury API routes (Fiscal Data + Yield Curve)

import { Hono } from 'hono';
import { getCachedTreasuryFiscal, getCachedYieldCurve } from '../services/treasury.js';

const treasury = new Hono();

// GET /api/treasury/fiscal - Treasury Fiscal Data (Debt, Cash, Interest Rates)
treasury.get('/fiscal', async (c) => {
  try {
    const { data, cached, stale } = await getCachedTreasuryFiscal();

    return c.json({
      ...data,
      _cache: { hit: cached, stale: stale || false },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('[Treasury] Fiscal endpoint error:', err);
    return c.json({ error: 'Failed to fetch Treasury fiscal data', message: err?.message }, 500);
  }
});

// GET /api/treasury/yield-curve - Yield Curve via FRED
treasury.get('/yield-curve', async (c) => {
  try {
    const daysParam = c.req.query('days');
    const days = daysParam ? Math.max(1, Math.min(parseInt(daysParam, 10) || 60, 365)) : 60;

    const { data, cached, stale } = await getCachedYieldCurve(days);

    return c.json({
      data,
      _cache: { hit: cached, stale: stale || false },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('[Treasury] Yield curve endpoint error:', err);
    return c.json({ error: 'Failed to fetch yield curve data', message: err?.message }, 500);
  }
});

export default treasury;
