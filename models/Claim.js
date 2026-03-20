const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema({
  worker_id:            { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  disruption_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'DisruptionEvent', required: true },
  shift_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  compensation_amount:  { type: Number, required: true },
  claim_status:         { type: String, enum: ['approved', 'rejected', 'blocked'], default: 'approved' },
  trigger_reason:       { type: String },
  block_reason:         { type: String },                          // why payout was blocked
  payout_tier:          { type: String, enum: ['Medium','High','Extreme'], default: 'High' },
  risk_details: {
    rainfall:           Number,
    aqi:                Number,
    traffic_level:      String,
    risk_score:         Number,
  },
  created_at:           { type: Date, default: Date.now }
});

module.exports = mongoose.model('Claim', claimSchema);
