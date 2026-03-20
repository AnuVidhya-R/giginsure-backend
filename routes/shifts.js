const router = require('express').Router();
const { protect } = require('../middleware/auth');
const Shift = require('../models/Shift');

router.post('/start', protect, async (req, res) => {
  try {
    const existing = await Shift.findOne({ worker_id: req.worker._id, status: 'active' });
    if (existing) return res.status(400).json({ message: 'Shift already active', shift: existing });
    const { lat, lng } = req.body;
    const shift = await Shift.create({
      worker_id: req.worker._id,
      gps_locations: lat && lng ? [{ lat, lng }] : []
    });
    res.status(201).json({ message: 'Shift started', shift });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/stop', protect, async (req, res) => {
  try {
    const shift = await Shift.findOneAndUpdate(
      { worker_id: req.worker._id, status: 'active' },
      { status: 'completed', end_time: new Date() },
      { new: true }
    );
    if (!shift) return res.status(404).json({ message: 'No active shift found' });
    res.json({ message: 'Shift completed', shift });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/location', protect, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const shift = await Shift.findOneAndUpdate(
      { worker_id: req.worker._id, status: 'active' },
      { $push: { gps_locations: { lat, lng, timestamp: new Date() } } },
      { new: true }
    );
    if (!shift) return res.status(404).json({ message: 'No active shift' });
    res.json({ message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/active', protect, async (req, res) => {
  try {
    const shift = await Shift.findOne({ worker_id: req.worker._id, status: 'active' });
    res.json({ active: !!shift, shift });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/history', protect, async (req, res) => {
  try {
    const shifts = await Shift.find({ worker_id: req.worker._id }).sort({ start_time: -1 }).limit(10);
    res.json(shifts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
