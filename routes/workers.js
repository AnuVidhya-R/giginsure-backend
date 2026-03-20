const router = require('express').Router();
const { protect } = require('../middleware/auth');
const Worker = require('../models/Worker');
const WalletTransaction = require('../models/WalletTransaction');
const InsurancePolicy = require('../models/InsurancePolicy');
const Shift = require('../models/Shift');
const Claim = require('../models/Claim');

router.get('/profile', protect, async (req, res) => {
  try {
    const worker = await Worker.findById(req.worker._id).select('-password');
    const activePolicy = await InsurancePolicy.findOne({ worker_id: req.worker._id, status: 'active', coverage_end: { $gte: new Date() } });
    const activeShift = await Shift.findOne({ worker_id: req.worker._id, status: 'active' });
    res.json({ worker, activePolicy, activeShift });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/profile', protect, async (req, res) => {
  try {
    const { name, phone, city, delivery_platform, work_type } = req.body;
    const worker = await Worker.findByIdAndUpdate(req.worker._id, { name, phone, city, delivery_platform, work_type }, { new: true }).select('-password');
    res.json(worker);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/wallet', protect, async (req, res) => {
  try {
    const transactions = await WalletTransaction.find({ worker_id: req.worker._id }).sort({ timestamp: -1 }).limit(20);
    const worker = await Worker.findById(req.worker._id).select('wallet_balance');
    res.json({ balance: worker.wallet_balance, transactions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/claims', protect, async (req, res) => {
  try {
    const claims = await Claim.find({ worker_id: req.worker._id })
      .populate('disruption_id')
      .sort({ created_at: -1 });
    res.json(claims);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
