const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const workerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  delivery_platform: { type: String, enum: ['Swiggy', 'Zomato', 'Blinkit', 'Other'], required: true },
  work_type: { type: String, enum: ['bike', 'cycle', 'foot'], default: 'bike' },
  wallet_balance: { type: Number, default: 0 },
  city: { type: String, default: 'Mumbai' },
  is_admin: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

workerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

workerSchema.methods.matchPassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('Worker', workerSchema);
