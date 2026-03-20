const mongoose = require('mongoose');

const payoutConfigSchema = new mongoose.Schema({
  max_payouts_per_month:  { type: Number, default: 2 },
  cooldown_days:          { type: Number, default: 7 },
  max_weekly_payouts:     { type: Number, default: 1 },
  min_shift_hours:        { type: Number, default: 2 },
  gps_radius_km:          { type: Number, default: 10 },
  monthly_fund_limit:     { type: Number, default: 50000 },  // platform-wide monthly cap
  payout_tiers: {
    Medium:  { type: Number, default: 100 },
    High:    { type: Number, default: 200 },
    Extreme: { type: Number, default: 300 },
  },
  trigger_only_high_risk: { type: Boolean, default: true },   // Medium = alert only
  updated_at:             { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('PayoutConfig', payoutConfigSchema);
