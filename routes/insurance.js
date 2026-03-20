const router = require('express').Router();
const { protect } = require('../middleware/auth');
const InsurancePolicy = require('../models/InsurancePolicy');
const Worker = require('../models/Worker');
const WalletTransaction = require('../models/WalletTransaction');

const PREMIUM = 20;

router.post('/activate', protect, async (req, res) => {
  try {
    const worker = await Worker.findById(req.worker._id);
    if (worker.wallet_balance < PREMIUM)
      return res.status(400).json({ message: 'Insufficient wallet balance. Add funds first.' });

    const existing = await InsurancePolicy.findOne({
      worker_id: worker._id,
      status: 'active',
      coverage_end: { $gte: new Date() }
    });
    if (existing) return res.status(400).json({ message: 'Active policy already exists', policy: existing });

    const now = new Date();
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const policy = await InsurancePolicy.create({
      worker_id: worker._id,
      premium_amount: PREMIUM,
      coverage_start: now,
      coverage_end: end
    });

    worker.wallet_balance -= PREMIUM;
    await worker.save();

    await WalletTransaction.create({
      worker_id: worker._id,
      type: 'debit',
      amount: PREMIUM,
      description: `Weekly insurance premium - Policy ${policy._id}`
    });

    res.status(201).json({ message: 'Insurance activated successfully', policy });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/status', protect, async (req, res) => {
  try {
    const policy = await InsurancePolicy.findOne({
      worker_id: req.worker._id,
      status: 'active',
      coverage_end: { $gte: new Date() }
    });
    res.json({ active: !!policy, policy });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/history', protect, async (req, res) => {
  try {
    const policies = await InsurancePolicy.find({ worker_id: req.worker._id }).sort({ created_at: -1 });
    res.json(policies);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add funds to wallet (demo)
router.post('/add-funds', protect, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    const worker = await Worker.findByIdAndUpdate(req.worker._id, { $inc: { wallet_balance: amount } }, { new: true });
    await WalletTransaction.create({ worker_id: req.worker._id, type: 'credit', amount, description: 'Wallet top-up' });
    res.json({ balance: worker.wallet_balance });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
