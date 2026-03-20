const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const Worker = require('../models/Worker');
const InsurancePolicy = require('../models/InsurancePolicy');
const Claim = require('../models/Claim');
const DisruptionEvent = require('../models/DisruptionEvent');
const WalletTransaction = require('../models/WalletTransaction');

router.get('/stats', protect, adminOnly, async (req, res) => {
  try {
    const [totalWorkers, activePolicies, totalClaims, disruptions, transactions] = await Promise.all([
      Worker.countDocuments({ is_admin: false }),
      InsurancePolicy.countDocuments({ status: 'active', coverage_end: { $gte: new Date() } }),
      Claim.countDocuments({ claim_status: 'approved' }),
      DisruptionEvent.find().sort({ timestamp: -1 }).limit(20),
      WalletTransaction.find({ type: 'debit', description: /premium/i })
    ]);

    const totalPremiums = transactions.reduce((sum, t) => sum + t.amount, 0);
    const claimPayouts = await Claim.aggregate([
      { $match: { claim_status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$compensation_amount' } } }
    ]);
    const totalPayouts = claimPayouts[0]?.total || 0;

    res.json({
      totalWorkers,
      activePolicies,
      totalClaims,
      insuranceFundBalance: totalPremiums - totalPayouts,
      totalPremiumsCollected: totalPremiums,
      totalPayouts,
      recentDisruptions: disruptions,
      riskZoneBreakdown: {
        High: disruptions.filter(d => d.disruption_risk === 'High').length,
        Medium: disruptions.filter(d => d.disruption_risk === 'Medium').length,
        Low: disruptions.filter(d => d.disruption_risk === 'Low').length
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/workers', protect, adminOnly, async (req, res) => {
  try {
    const workers = await Worker.find({ is_admin: false }).select('-password').limit(50);
    res.json(workers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/claims', protect, adminOnly, async (req, res) => {
  try {
    const claims = await Claim.find()
      .populate('worker_id', 'name phone delivery_platform')
      .populate('disruption_id')
      .sort({ created_at: -1 })
      .limit(50);
    res.json(claims);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
