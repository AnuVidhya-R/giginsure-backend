const router = require('express').Router();
const { protect } = require('../middleware/auth');
const DisruptionEvent = require('../models/DisruptionEvent');
const InsurancePolicy = require('../models/InsurancePolicy');
const Shift = require('../models/Shift');

router.get('/', protect, async (req, res) => {
  try {
    const city = req.worker.city || 'Mumbai';
    const [latest, activePolicy, activeShift] = await Promise.all([
      DisruptionEvent.find({ city }).sort({ timestamp: -1 }).limit(3),
      InsurancePolicy.findOne({ worker_id: req.worker._id, status: 'active', coverage_end: { $gte: new Date() } }),
      Shift.findOne({ worker_id: req.worker._id, status: 'active' }),
    ]);

    const alerts = [];
    const now = Date.now();

    latest.forEach(d => {
      const age = (now - new Date(d.timestamp)) / 60000; // minutes
      if (age > 30) return; // only show alerts < 30 min old

      if (d.disruption_risk === 'High') {
        alerts.push({ id: d._id, type: 'danger', icon: '🚨', title: 'High Risk Detected', message: `Heavy disruption in ${city} — Rainfall: ${d.rainfall?.toFixed(0)}mm, AQI: ${d.aqi}`, time: d.timestamp });
        if (activeShift) alerts.push({ id: `stop-${d._id}`, type: 'warning', icon: '🌧️', title: 'Consider Stopping Shift', message: 'Heavy rain detected in your area. Stay safe!', time: d.timestamp });
        if (activePolicy && activeShift) alerts.push({ id: `payout-${d._id}`, type: 'success', icon: '💰', title: 'Payout Triggered!', message: `₹200 has been credited to your wallet automatically.`, time: d.timestamp });
      } else if (d.disruption_risk === 'Medium') {
        alerts.push({ id: d._id, type: 'warning', icon: '⚠️', title: 'Medium Risk Alert', message: `Moderate disruption in ${city} — AQI: ${d.aqi}, Traffic: ${d.traffic_level}`, time: d.timestamp });
      }
    });

    if (!activePolicy) alerts.push({ id: 'no-policy', type: 'info', icon: '🛡️', title: 'Insurance Not Active', message: 'Activate insurance for ₹20/week to get auto-payouts during disruptions.', time: new Date() });
    if (!activeShift && activePolicy) alerts.push({ id: 'no-shift', type: 'info', icon: '🛵', title: 'Start Your Shift', message: 'Your insurance is active. Start a shift to become eligible for payouts.', time: new Date() });

    res.json(alerts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
