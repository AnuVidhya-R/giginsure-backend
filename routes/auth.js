const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const Worker = require('../models/Worker');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// Email pattern: anything ending with "admin" before @gmail.com
// e.g. ravi_admin@gmail.com, gigadmin@gmail.com, john.admin@gmail.com
const isAdminEmail = (email) => /^.+admin@/i.test(email);

router.post('/register', async (req, res) => {
  try {
    const { name, phone, email, password, delivery_platform, work_type, city } = req.body;
    if (await Worker.findOne({ email })) return res.status(400).json({ message: 'Email already exists' });

    const is_admin = isAdminEmail(email);

    const worker = await Worker.create({
      name, phone, email, password,
      delivery_platform: delivery_platform || 'Other',
      work_type: work_type || 'bike',
      city: city || 'Mumbai',
      is_admin,
    });

    res.status(201).json({
      token: signToken(worker._id),
      worker: { id: worker._id, name: worker.name, email: worker.email, is_admin: worker.is_admin, wallet_balance: worker.wallet_balance }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const worker = await Worker.findOne({ email });
    if (!worker || !(await worker.matchPassword(password)))
      return res.status(401).json({ message: 'Invalid credentials' });

    // Auto-upgrade existing account to admin if email matches pattern
    if (isAdminEmail(email) && !worker.is_admin) {
      worker.is_admin = true;
      await worker.save();
    }

    res.json({
      token: signToken(worker._id),
      worker: { id: worker._id, name: worker.name, email: worker.email, is_admin: worker.is_admin, wallet_balance: worker.wallet_balance }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
