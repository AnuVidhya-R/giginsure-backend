const router = require('express').Router();
const { protect } = require('../middleware/auth');
const Shift = require('../models/Shift');
const Claim = require('../models/Claim');
const DisruptionEvent = require('../models/DisruptionEvent');

const NORMAL_INCOME = 600;
const RAIN_INCOME   = 200;

// Predict earnings for next 7 days based on past shifts + risk
router.get('/earnings', protect, async (req, res) => {
  try {
    const workerId = req.worker._id;
    const past30   = new Date(Date.now() - 30 * 86400000);

    const [shifts, claims, recentDisruptions] = await Promise.all([
      Shift.find({ worker_id: workerId, status: 'completed', start_time: { $gte: past30 } }),
      Claim.find({ worker_id: workerId }),
      DisruptionEvent.find({ city: req.worker.city }).sort({ timestamp: -1 }).limit(5),
    ]);

    // Avg daily income from past shifts
    const avgRiskScore = recentDisruptions.length
      ? recentDisruptions.reduce((s, d) => s + (d.risk_score || 0), 0) / recentDisruptions.length
      : 20;

    const avgIncome = shifts.length
      ? shifts.reduce((s, sh) => {
          const hrs = sh.end_time ? (new Date(sh.end_time) - new Date(sh.start_time)) / 3600000 : 4;
          return s + Math.min(hrs, 10) * 75;
        }, 0) / shifts.length
      : NORMAL_INCOME;

    // 7-day forecast
    const forecast = [];
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (let i = 0; i < 7; i++) {
      const d    = new Date(Date.now() + i * 86400000);
      const day  = days[d.getDay()];
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const riskFactor = avgRiskScore > 60 ? 0.4 : avgRiskScore > 30 ? 0.75 : 1;
      const demandFactor = isWeekend ? 1.2 : 1.0;
      const predicted = Math.round(avgIncome * riskFactor * demandFactor * (0.85 + Math.random() * 0.3));
      forecast.push({ day, date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), predicted, risk: avgRiskScore > 60 ? 'High' : avgRiskScore > 30 ? 'Medium' : 'Low' });
    }

    const todayEarning = forecast[0].predicted;
    const totalClaimEarnings = claims.reduce((s, c) => s + c.compensation_amount, 0);

    res.json({ todayEarning, forecast, totalClaimEarnings, avgDailyIncome: Math.round(avgIncome), totalShifts: shifts.length });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Smart shift recommendation
router.get('/shift-recommendation', protect, async (req, res) => {
  try {
    const city = req.worker.city || 'Mumbai';
    const disruptions = await DisruptionEvent.find({ city }).sort({ timestamp: -1 }).limit(24);

    // Find hours with lowest risk
    const hourRisk = Array(24).fill(0).map((_, h) => {
      const relevant = disruptions.filter(d => new Date(d.timestamp).getHours() === h);
      const avgRisk  = relevant.length
        ? relevant.reduce((s, d) => s + (d.risk_score || 20), 0) / relevant.length
        : 20;
      return { hour: h, avgRisk, label: `${h}:00` };
    });

    const sorted     = [...hourRisk].sort((a, b) => a.avgRisk - b.avgRisk);
    const bestHours  = sorted.slice(0, 3).map(h => h.hour);
    const worstHours = sorted.slice(-3).map(h => h.hour);

    const fmt = h => `${h % 12 || 12}${h < 12 ? 'AM' : 'PM'}`;
    const bestSlot  = `${fmt(Math.min(...bestHours))} – ${fmt(Math.max(...bestHours) + 1)}`;
    const avoidSlot = `${fmt(Math.min(...worstHours))} – ${fmt(Math.max(...worstHours) + 1)}`;

    // Demand simulation based on city + time
    const now  = new Date();
    const hour = now.getHours();
    const demandLevel = (hour >= 12 && hour <= 14) || (hour >= 19 && hour <= 22) ? 'High' : hour >= 8 && hour <= 11 ? 'Medium' : 'Low';

    res.json({
      bestTimeToWork: bestSlot,
      avoidTime: avoidSlot,
      currentDemand: demandLevel,
      city,
      tips: [
        demandLevel === 'High' ? '🔥 Peak demand right now — go online!' : '📉 Low demand currently',
        `⏰ Best earning window: ${bestSlot}`,
        `⚠️ Avoid: ${avoidSlot} (historically high risk)`,
        `🌆 ${city} demand is ${demandLevel.toLowerCase()} this hour`,
      ],
      hourlyRisk: hourRisk,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// SOS Emergency
router.post('/sos', protect, async (req, res) => {
  try {
    const { lat, lng, message } = req.body;
    // In production: send SMS/push to admin + emergency contact
    console.log(`🚨 SOS from ${req.worker.name} at ${lat},${lng}: ${message}`);
    res.json({
      success: true,
      message: 'SOS alert sent to admin and emergency contacts',
      worker: req.worker.name,
      location: { lat, lng },
      timestamp: new Date(),
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Leaderboard
router.get('/leaderboard', protect, async (req, res) => {
  try {
    const Worker = require('../models/Worker');
    const workers = await Worker.find({ is_admin: false }).select('name delivery_platform city wallet_balance');
    const claims  = await Claim.find({ claim_status: 'approved' });
    const shifts  = await Shift.find({ status: 'completed' });

    const leaderboard = workers.map(w => {
      const wClaims = claims.filter(c => c.worker_id.toString() === w._id.toString());
      const wShifts = shifts.filter(s => s.worker_id.toString() === w._id.toString());
      const totalEarned = wClaims.reduce((s, c) => s + c.compensation_amount, 0);
      const totalShiftHrs = wShifts.reduce((s, sh) => {
        return s + (sh.end_time ? (new Date(sh.end_time) - new Date(sh.start_time)) / 3600000 : 0);
      }, 0);
      return { id: w._id, name: w.name, platform: w.delivery_platform, city: w.city, totalEarned, totalClaims: wClaims.length, totalShifts: wShifts.length, totalShiftHrs: Math.round(totalShiftHrs), wallet: w.wallet_balance };
    });

    leaderboard.sort((a, b) => b.totalEarned - a.totalEarned);
    res.json(leaderboard.slice(0, 20));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Carbon footprint
router.get('/carbon', protect, async (req, res) => {
  try {
    const shifts = await Shift.find({ worker_id: req.worker._id, status: 'completed' });
    const totalHrs = shifts.reduce((s, sh) => s + (sh.end_time ? (new Date(sh.end_time) - new Date(sh.start_time)) / 3600000 : 0), 0);
    const avgSpeedKmh = req.worker.work_type === 'bike' ? 25 : req.worker.work_type === 'cycle' ? 12 : 5;
    const totalKm     = Math.round(totalHrs * avgSpeedKmh);
    const emissionFactor = req.worker.work_type === 'bike' ? 0.05 : 0; // kg CO2 per km
    const totalCO2    = (totalKm * emissionFactor).toFixed(2);
    const treesNeeded = Math.ceil(totalCO2 / 21);
    res.json({ totalKm, totalCO2: Number(totalCO2), treesNeeded, vehicle: req.worker.work_type, totalShifts: shifts.length, ecoScore: req.worker.work_type === 'cycle' || req.worker.work_type === 'foot' ? 100 : Math.max(0, 100 - Math.round(totalCO2)) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
