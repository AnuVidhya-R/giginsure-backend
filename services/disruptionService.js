const Claim          = require('../models/Claim');
const Shift          = require('../models/Shift');
const InsurancePolicy = require('../models/InsurancePolicy');
const Worker         = require('../models/Worker');
const WalletTransaction = require('../models/WalletTransaction');
const PayoutConfig   = require('../models/PayoutConfig');
const DisruptionEvent = require('../models/DisruptionEvent');
const { fetchWeather, fetchAQI, fetchTraffic, getRiskFromAI, CITY_COORDS } = require('../routes/disruptions');

// ── Get or create default config ──────────────────────────────────────────────
async function getConfig() {
  let cfg = await PayoutConfig.findOne();
  if (!cfg) cfg = await PayoutConfig.create({});
  return cfg;
}

// ── Determine payout tier from disruption data ────────────────────────────────
function getPayoutTier(disruption, cfg) {
  const { rainfall = 0, aqi = 0, traffic_index = 0, risk_score = 0 } = disruption;
  if (risk_score >= 80 || rainfall > 60 || aqi > 400 || traffic_index > 85) return 'Extreme';
  if (disruption.disruption_risk === 'High') return 'High';
  return 'Medium';
}

// ── Full eligibility check for one worker ─────────────────────────────────────
async function checkEligibility(workerId, shift, disruption, cfg) {
  const now   = new Date();
  const checks = [];

  // 1. Active insurance policy
  const policy = await InsurancePolicy.findOne({
    worker_id: workerId, status: 'active', coverage_end: { $gte: now }
  });
  if (!policy) return { eligible: false, reason: 'No active insurance policy', checks };

  // 2. Duplicate claim for same disruption
  const dup = await Claim.findOne({ worker_id: workerId, disruption_id: disruption._id, claim_status: 'approved' });
  if (dup) return { eligible: false, reason: 'Already claimed for this disruption event', checks };

  // 3. Monthly cap (max N payouts per month)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthClaims = await Claim.countDocuments({ worker_id: workerId, claim_status: 'approved', created_at: { $gte: monthStart } });
  if (monthClaims >= cfg.max_payouts_per_month) {
    return { eligible: false, reason: `Monthly cap reached (${cfg.max_payouts_per_month} payouts/month)`, checks };
  }

  // 4. Weekly cap (max 1 payout per active policy week)
  const weekStart = new Date(policy.coverage_start);
  const weekClaims = await Claim.countDocuments({ worker_id: workerId, claim_status: 'approved', created_at: { $gte: weekStart } });
  if (weekClaims >= cfg.max_weekly_payouts) {
    return { eligible: false, reason: `Weekly cap reached (${cfg.max_weekly_payouts} payout/week)`, checks };
  }

  // 5. Cooldown check (min N days since last payout)
  const lastClaim = await Claim.findOne({ worker_id: workerId, claim_status: 'approved' }).sort({ created_at: -1 });
  if (lastClaim) {
    const daysSince = (now - new Date(lastClaim.created_at)) / 86400000;
    if (daysSince < cfg.cooldown_days) {
      const nextEligible = new Date(lastClaim.created_at.getTime() + cfg.cooldown_days * 86400000);
      return { eligible: false, reason: `Cooldown active — next eligible: ${nextEligible.toLocaleDateString()}`, checks };
    }
  }

  // 6. Minimum shift duration (N hours)
  const shiftHours = (now - new Date(shift.start_time)) / 3600000;
  if (shiftHours < cfg.min_shift_hours) {
    return { eligible: false, reason: `Shift too short (${shiftHours.toFixed(1)}h < ${cfg.min_shift_hours}h required)`, checks };
  }

  // 7. GPS proximity check (within radius)
  if (shift.gps_locations?.length > 0) {
    const last = shift.gps_locations[shift.gps_locations.length - 1];
    const dist = calcDistance(last.lat, last.lng, disruption.location.lat, disruption.location.lng);
    if (dist > cfg.gps_radius_km) {
      return { eligible: false, reason: `Worker outside disruption zone (${dist.toFixed(1)}km > ${cfg.gps_radius_km}km)`, checks };
    }
  }

  // 8. Platform-wide monthly fund limit
  const platformMonthClaims = await Claim.aggregate([
    { $match: { claim_status: 'approved', created_at: { $gte: monthStart } } },
    { $group: { _id: null, total: { $sum: '$compensation_amount' } } }
  ]);
  const platformSpent = platformMonthClaims[0]?.total || 0;
  if (platformSpent >= cfg.monthly_fund_limit) {
    return { eligible: false, reason: 'Platform monthly fund limit reached — payouts paused', checks };
  }

  return { eligible: true, reason: 'All conditions met', policy, monthClaims, weekClaims };
}

// ── Process payouts for a disruption event ────────────────────────────────────
async function processPayoutsForDisruption(disruption) {
  try {
    const cfg  = await getConfig();
    const city = disruption.city;

    // Only trigger payout for High/Extreme — Medium = alert only
    if (cfg.trigger_only_high_risk && disruption.disruption_risk === 'Medium') {
      console.log(`${city}: Medium risk — alerts only, no payout`);
      return { payouts: 0, alerts: 0 };
    }

    const tier   = getPayoutTier(disruption, cfg);
    const amount = cfg.payout_tiers[tier] || 200;

    const activeWorkers = await Worker.find({ city, is_admin: false });
    const workerIds     = activeWorkers.map(w => w._id);
    const activeShifts  = await Shift.find({ worker_id: { $in: workerIds }, status: 'active' });

    console.log(`${city}: ${disruption.disruption_risk} risk | Tier: ${tier} | ₹${amount} | ${activeShifts.length} active shifts`);

    let payouts = 0, blocked = 0;

    for (const shift of activeShifts) {
      const { eligible, reason, policy } = await checkEligibility(shift.worker_id, shift, disruption, cfg);

      if (!eligible) {
        // Log blocked claim
        await Claim.create({
          worker_id: shift.worker_id, disruption_id: disruption._id, shift_id: shift._id,
          compensation_amount: 0, claim_status: 'blocked', block_reason: reason,
          payout_tier: tier,
          risk_details: { rainfall: disruption.rainfall, aqi: disruption.aqi, traffic_level: disruption.traffic_level, risk_score: disruption.risk_score },
          trigger_reason: `Blocked: ${reason}`
        });
        console.log(`⛔ Blocked payout for ${shift.worker_id}: ${reason}`);
        blocked++;
        continue;
      }

      // Approved payout
      await Claim.create({
        worker_id: shift.worker_id, disruption_id: disruption._id, shift_id: shift._id,
        compensation_amount: amount, claim_status: 'approved', payout_tier: tier,
        risk_details: { rainfall: disruption.rainfall, aqi: disruption.aqi, traffic_level: disruption.traffic_level, risk_score: disruption.risk_score },
        trigger_reason: `${tier} risk in ${city} | Rain: ${disruption.rainfall?.toFixed(1)}mm | AQI: ${disruption.aqi} | Traffic: ${disruption.traffic_level?.toUpperCase()}`
      });

      await Worker.findByIdAndUpdate(shift.worker_id, { $inc: { wallet_balance: amount } });
      await WalletTransaction.create({
        worker_id: shift.worker_id, type: 'credit', amount,
        description: `Insurance payout [${tier}] — ${city} disruption`
      });

      console.log(`✅ Payout ₹${amount} [${tier}] → worker ${shift.worker_id}`);
      payouts++;
    }

    return { payouts, blocked };
  } catch (err) {
    console.error('Payout processing error:', err.message);
    return { payouts: 0, blocked: 0 };
  }
}

// ── Worker eligibility status (for UI) ───────────────────────────────────────
async function getWorkerEligibilityStatus(workerId, city) {
  const cfg = await getConfig();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [policy, monthClaims, lastClaim, activeShift, recentDisruption] = await Promise.all([
    InsurancePolicy.findOne({ worker_id: workerId, status: 'active', coverage_end: { $gte: now } }),
    Claim.countDocuments({ worker_id: workerId, claim_status: 'approved', created_at: { $gte: monthStart } }),
    Claim.findOne({ worker_id: workerId, claim_status: 'approved' }).sort({ created_at: -1 }),
    Shift.findOne({ worker_id: workerId, status: 'active' }),
    DisruptionEvent.findOne({ city }).sort({ timestamp: -1 }),
  ]);

  const weekStart    = policy ? new Date(policy.coverage_start) : monthStart;
  const weekClaims   = await Claim.countDocuments({ worker_id: workerId, claim_status: 'approved', created_at: { $gte: weekStart } });
  const cooldownDays = lastClaim ? Math.max(0, cfg.cooldown_days - (now - new Date(lastClaim.created_at)) / 86400000) : 0;
  const nextEligible = lastClaim ? new Date(lastClaim.created_at.getTime() + cfg.cooldown_days * 86400000) : null;
  const shiftHours   = activeShift ? (now - new Date(activeShift.start_time)) / 3600000 : 0;

  const checks = [
    { label: 'Insurance active',       ok: !!policy,                                          detail: policy ? `Expires ${new Date(policy.coverage_end).toLocaleDateString()}` : 'Not activated' },
    { label: 'Shift running',          ok: !!activeShift,                                     detail: activeShift ? `${shiftHours.toFixed(1)}h active` : 'No active shift' },
    { label: `Min shift (${cfg.min_shift_hours}h)`, ok: shiftHours >= cfg.min_shift_hours,   detail: `${shiftHours.toFixed(1)}h / ${cfg.min_shift_hours}h required` },
    { label: 'Monthly cap',            ok: monthClaims < cfg.max_payouts_per_month,           detail: `${monthClaims} / ${cfg.max_payouts_per_month} used` },
    { label: 'Weekly cap',             ok: weekClaims < cfg.max_weekly_payouts,               detail: `${weekClaims} / ${cfg.max_weekly_payouts} used` },
    { label: 'Cooldown clear',         ok: cooldownDays <= 0,                                 detail: cooldownDays > 0 ? `${cooldownDays.toFixed(1)} days remaining` : 'Ready' },
    { label: 'High risk required',     ok: recentDisruption?.disruption_risk === 'High' || recentDisruption?.disruption_risk === 'Extreme', detail: recentDisruption ? `Current: ${recentDisruption.disruption_risk}` : 'No data' },
  ];

  const eligible = checks.every(c => c.ok);

  return {
    eligible, checks, cfg,
    monthPayouts: monthClaims, maxMonthPayouts: cfg.max_payouts_per_month,
    weekPayouts: weekClaims,   maxWeekPayouts: cfg.max_weekly_payouts,
    cooldownDays: cooldownDays.toFixed(1), nextEligible,
    currentTier: recentDisruption ? getPayoutTier(recentDisruption, cfg) : null,
    currentAmount: recentDisruption ? (cfg.payout_tiers[getPayoutTier(recentDisruption, cfg)] || 200) : 200,
  };
}

// ── Cron disruption check ─────────────────────────────────────────────────────
async function runDisruptionCheck() {
  try {
    const cities = Object.keys(CITY_COORDS);
    for (const city of cities) {
      const coords = CITY_COORDS[city];
      const [weather, aqi, traffic] = await Promise.all([
        fetchWeather(coords.lat, coords.lng),
        fetchAQI(coords.lat, coords.lng),
        fetchTraffic(coords.lat, coords.lng)
      ]);
      const risk = await getRiskFromAI(weather.rainfall, aqi, traffic.index);
      console.log(`[CRON] ${city}: rain=${weather.rainfall?.toFixed(1)}mm AQI=${aqi} traffic=${traffic.index} → ${risk}`);
      if (risk === 'Low') continue;

      const disruption = await DisruptionEvent.create({
        city, location: coords,
        rainfall: weather.rainfall, aqi,
        traffic_level: traffic.level, traffic_index: traffic.index,
        disruption_risk: risk,
        risk_score: Math.round((weather.rainfall / 50 + aqi / 500 + traffic.index / 100) * 33)
      });
      await processPayoutsForDisruption(disruption);
    }
  } catch (err) { console.error('Disruption check error:', err.message); }
}

function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

module.exports = { runDisruptionCheck, processPayoutsForDisruption, getWorkerEligibilityStatus, getConfig };
