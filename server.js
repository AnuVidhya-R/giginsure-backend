require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const { runDisruptionCheck } = require('./services/disruptionService');


const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/workers', require('./routes/workers'));
app.use('/api/insurance', require('./routes/insurance'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/disruptions', require('./routes/disruptions'));
app.use('/api/claims', require('./routes/claims'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/payouts', require('./routes/payouts'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    cron.schedule('*/15 * * * *', () => {
      console.log('Running disruption check...');
      runDisruptionCheck();
    });
  })
  .catch((err) => console.error('MongoDB connection error:', err.message));

// Start server regardless of DB status
app.listen(process.env.PORT || 5000, () =>
  console.log(`Server running on port ${process.env.PORT || 5000}`)
);
