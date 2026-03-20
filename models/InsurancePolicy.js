const mongoose = require('mongoose');

const insurancePolicySchema = new mongoose.Schema({
  worker_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  premium_amount: { type: Number, default: 20 },
  coverage_start: { type: Date, required: true },
  coverage_end: { type: Date, required: true },
  status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('InsurancePolicy', insurancePolicySchema);
