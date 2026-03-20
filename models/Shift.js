const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
  worker_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  start_time: { type: Date, default: Date.now },
  end_time: { type: Date },
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  gps_locations: [
    {
      lat: Number,
      lng: Number,
      timestamp: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model('Shift', shiftSchema);
