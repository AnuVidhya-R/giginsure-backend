const router = require('express').Router();
const { protect } = require('../middleware/auth');
const Claim = require('../models/Claim');

// GET all claims for logged-in worker
router.get('/', protect, async (req, res) => {
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
