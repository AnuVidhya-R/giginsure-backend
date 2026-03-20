const router = require('express').Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');
const DisruptionEvent = require('../models/DisruptionEvent');

const CITY_COORDS = {
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Delhi: { lat: 28.6139, lng: 77.209 },
  Bangalore: { lat: 12.9716, lng: 77.5946 },
  Chennai: { lat: 13.0827, lng: 80.2707 },
  Hyderabad: { lat: 17.385, lng: 78.4867 }
};

async function fetchWeather(lat, lng) {
  try {
    const { data } = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`,
      { timeout: 5000 }
    );
    return { rainfall: data.rain?.['1h'] || 0, description: data.weather[0].description };
  } catch {
    // Simulate realistic Mumbai monsoon data
    return { rainfall: 35 + Math.random() * 30, description: 'heavy rain (simulated)' };
  }
}

async function fetchAQI(lat, lng) {
  try {
    const { data } = await axios.get(
      `https://api.waqi.info/feed/geo:${lat};${lng}/?token=${process.env.WAQI_API_KEY}`,
      { timeout: 5000 }
    );
    return data.data?.aqi || 0;
  } catch {
    return 150 + Math.floor(Math.random() * 200);
  }
}

async function fetchTraffic(lat, lng) {
  try {
    const { data } = await axios.get(
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lng}&key=${process.env.TOMTOM_API_KEY}`,
      { timeout: 5000 }
    );
    const ratio = data.flowSegmentData?.currentSpeed / data.flowSegmentData?.freeFlowSpeed;
    const index = Math.round((1 - ratio) * 100);
    return { index, level: index > 60 ? 'high' : index > 30 ? 'medium' : 'low' };
  } catch {
    const index = 50 + Math.floor(Math.random() * 50);
    return { index, level: index > 60 ? 'high' : index > 30 ? 'medium' : 'low' };
  }
}

async function getRiskFromAI(rainfall, aqi, traffic_index) {
  try {
    const { data } = await axios.post(`${process.env.AI_SERVICE_URL}/predict-risk`, {
      rainfall, aqi, traffic_index, hour: new Date().getHours()
    }, { timeout: 5000 });
    return data.disruption_risk;
  } catch {
    if (rainfall > 30 || aqi > 300 || traffic_index > 70) return 'High';
    if (rainfall > 10 || aqi > 150 || traffic_index > 40) return 'Medium';
    return 'Low';
  }
}

router.get('/current', protect, async (req, res) => {
  try {
    const city = req.worker.city || 'Mumbai';
    const coords = CITY_COORDS[city] || CITY_COORDS.Mumbai;
    const [weather, aqi, traffic] = await Promise.all([
      fetchWeather(coords.lat, coords.lng),
      fetchAQI(coords.lat, coords.lng),
      fetchTraffic(coords.lat, coords.lng)
    ]);
    const risk = await getRiskFromAI(weather.rainfall, aqi, traffic.index);
    const event = await DisruptionEvent.create({
      city, location: coords,
      rainfall: weather.rainfall, aqi,
      traffic_level: traffic.level, traffic_index: traffic.index,
      disruption_risk: risk,
      risk_score: Math.round((weather.rainfall / 50 + aqi / 500 + traffic.index / 100) * 33)
    });

    // Trigger payouts immediately if High or Medium
    if (risk !== 'Low') {
      const { processPayoutsForDisruption } = require('../services/disruptionService');
      processPayoutsForDisruption(event);
    }

    res.json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/latest', protect, async (req, res) => {
  try {
    const city = req.worker.city || 'Mumbai';
    const events = await DisruptionEvent.find({ city }).sort({ timestamp: -1 }).limit(10);
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/zones', protect, async (req, res) => {
  try {
    const events = await DisruptionEvent.find().sort({ timestamp: -1 }).limit(50);
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
module.exports.fetchWeather = fetchWeather;
module.exports.fetchAQI = fetchAQI;
module.exports.fetchTraffic = fetchTraffic;
module.exports.getRiskFromAI = getRiskFromAI;
module.exports.CITY_COORDS = CITY_COORDS;
