const router = require('express').Router();
const { protect } = require('../middleware/auth');
const DisruptionEvent = require('../models/DisruptionEvent');
const InsurancePolicy = require('../models/InsurancePolicy');
const Worker = require('../models/Worker');
const WalletTransaction = require('../models/WalletTransaction');

router.get('/dynamic-price', protect, async (req, res) => {
  try {
    const city = req.worker.city || 'Mumbai';
    const recent = await DisruptionEvent.find({ city }).sort({ timestamp: -1 }).limit(5);
    const avgRisk = recent.length ? recent.reduce((s, d) => s + (d.risk_score || 20), 0) / recent.length : 20;

    let premium, riskTier, reason;
    if (avgRisk > 60) {
      premium = 30; riskTier = 'High';
      reason = `High disruption activity in ${city} — premium adjusted to ₹30`;
    } else if (avgRisk > 30) {
      premium = 20; riskTier = 'Medium';
      reason = `Moderate conditions in ${city} — standard premium ₹20`;
    } else {
      premium = 15; riskTier = 'Low';
      reason = `Low risk in ${city} — discounted premium ₹15`;
    }

    res.json({ premium, riskTier, reason, city, avgRiskScore: Math.round(avgRisk) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/activate-dynamic', protect, async (req, res) => {
  try {
    const city = req.worker.city || 'Mumbai';
    const recent = await DisruptionEvent.find({ city }).sort({ timestamp: -1 }).limit(5);
    const avgRisk = recent.length ? recent.reduce((s, d) => s + (d.risk_score || 20), 0) / recent.length : 20;
    const premium = avgRisk > 60 ? 30 : avgRisk > 30 ? 20 : 15;

    const worker = await Worker.findById(req.worker._id);
    if (worker.wallet_balance < premium) return res.status(400).json({ message: `Insufficient balance. Need ₹${premium}.` });

    const existing = await InsurancePolicy.findOne({ worker_id: worker._id, status: 'active', coverage_end: { $gte: new Date() } });
    if (existing) return res.status(400).json({ message: 'Active policy already exists', policy: existing });

    const now = new Date();
    const end = new Date(now.getTime() + 7 * 86400000);
    const policy = await InsurancePolicy.create({ worker_id: worker._id, premium_amount: premium, coverage_start: now, coverage_end: end });

    worker.wallet_balance -= premium;
    await worker.save();
    await WalletTransaction.create({ worker_id: worker._id, type: 'debit', amount: premium, description: `Dynamic insurance premium (${avgRisk > 60 ? 'High' : avgRisk > 30 ? 'Medium' : 'Low'} risk) - Policy ${policy._id}` });

    res.status(201).json({ message: `Insurance activated for ₹${premium}`, policy, premium });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
