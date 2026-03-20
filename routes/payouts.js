const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const { getWorkerEligibilityStatus, getConfig } = require('../services/disruptionService');
const PayoutConfig = require('../models/PayoutConfig');
const Claim        = require('../models/Claim');
const Worker       = require('../models/Worker');

// Worker: get full eligibility status
router.get('/eligibility', protect, async (req, res) => {
  try {
    const status = await getWorkerEligibilityStatus(req.worker._id, req.worker.city || 'Mumbai');
    res.json(status);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Worker: get payout history with reasons
router.get('/history', protect, async (req, res) => {
  try {
    const claims = await Claim.find({ worker_id: req.worker._id })
      .populate('disruption_id')
      .sort({ created_at: -1 })
      .limit(20);
    res.json(claims);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin: get current config
router.get('/config', protect, adminOnly, async (req, res) => {
  try {
    const cfg = await getConfig();
    res.json(cfg);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin: update config
router.put('/config', protect, adminOnly, async (req, res) => {
  try {
    const { max_payouts_per_month, cooldown_days, max_weekly_payouts, min_shift_hours,
            gps_radius_km, monthly_fund_limit, payout_tiers, trigger_only_high_risk } = req.body;
    let cfg = await PayoutConfig.findOne();
    if (!cfg) cfg = new PayoutConfig();
    if (max_payouts_per_month !== undefined) cfg.max_payouts_per_month = max_payouts_per_month;
    if (cooldown_days         !== undefined) cfg.cooldown_days         = cooldown_days;
    if (max_weekly_payouts    !== undefined) cfg.max_weekly_payouts    = max_weekly_payouts;
    if (min_shift_hours       !== undefined) cfg.min_shift_hours       = min_shift_hours;
    if (gps_radius_km         !== undefined) cfg.gps_radius_km         = gps_radius_km;
    if (monthly_fund_limit    !== undefined) cfg.monthly_fund_limit    = monthly_fund_limit;
    if (payout_tiers          !== undefined) cfg.payout_tiers          = { ...cfg.payout_tiers, ...payout_tiers };
    if (trigger_only_high_risk !== undefined) cfg.trigger_only_high_risk = trigger_only_high_risk;
    cfg.updated_at = new Date();
    await cfg.save();
    res.json({ message: 'Config updated', cfg });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin: payout analytics
router.get('/analytics', protect, adminOnly, async (req, res) => {
  try {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [approved, blocked, monthApproved, monthBlocked, tierBreakdown, blockReasons] = await Promise.all([
      Claim.countDocuments({ claim_status: 'approved' }),
      Claim.countDocuments({ claim_status: 'blocked' }),
      Claim.countDocuments({ claim_status: 'approved', created_at: { $gte: monthStart } }),
      Claim.countDocuments({ claim_status: 'blocked',  created_at: { $gte: monthStart } }),
      Claim.aggregate([{ $match: { claim_status: 'approved' } }, { $group: { _id: '$payout_tier', count: { $sum: 1 }, total: { $sum: '$compensation_amount' } } }]),
      Claim.aggregate([{ $match: { claim_status: 'blocked' } },  { $group: { _id: '$block_reason', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]),
    ]);

    const monthSpend = await Claim.aggregate([
      { $match: { claim_status: 'approved', created_at: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$compensation_amount' } } }
    ]);

    const cfg = await getConfig();

    res.json({
      total: { approved, blocked, blockRate: approved + blocked > 0 ? Math.round((blocked / (approved + blocked)) * 100) : 0 },
      thisMonth: { approved: monthApproved, blocked: monthBlocked, spend: monthSpend[0]?.total || 0, fundLimit: cfg.monthly_fund_limit, fundUsedPct: Math.round(((monthSpend[0]?.total || 0) / cfg.monthly_fund_limit) * 100) },
      tierBreakdown,
      blockReasons,
      cfg,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
