const jwt = require('jsonwebtoken');
const Worker = require('../models/Worker');

const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.worker = await Worker.findById(decoded.id).select('-password');
    if (!req.worker) return res.status(401).json({ message: 'Worker not found' });
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.worker.is_admin) return res.status(403).json({ message: 'Admin access required' });
  next();
};

module.exports = { protect, adminOnly };
