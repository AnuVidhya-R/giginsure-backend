const mongoose = require('mongoose');

const disruptionEventSchema = new mongoose.Schema({
  city: { type: String, required: true },
  location: {
    lat: Number,
    lng: Number
  },
  rainfall: { type: Number, default: 0 },
  aqi: { type: Number, default: 0 },
  traffic_level: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  traffic_index: { type: Number, default: 0 },
  disruption_risk: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Low' },
  risk_score: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DisruptionEvent', disruptionEventSchema);
