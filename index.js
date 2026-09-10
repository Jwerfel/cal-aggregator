const express = require('express');
const axios = require('axios');
const ICAL = require('ical.js');
const icalGenerator = require('ical-generator').default;
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const app = express();
const PORT = process.env.PORT || config.port || 3000;

// Ensure logs directory exists
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Setup Winston Logger (console + file output)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logDir, 'app.log') }),
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' })
  ]
});

// In-memory cache
const eventCache = {};

/**
 * Fetch and parse an ICS feed. Filter events to >= 14 days ago.
 */
async function refreshCalendar(calConfig) {
  if (!calConfig.enabled) return;

  try {
    logger.info(`Refreshing source: ${calConfig.id}`);
    const response = await axios.get(calConfig.url, { timeout: 10000 });
    const parsedIcal = ICAL.parse(response.data);
    const comp = new ICAL.Component(parsedIcal);
    const vevents = comp.getAllSubcomponents('vevent');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 14);

    const validEvents = [];

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);

      const eventStart = event.startDate ? event.startDate.toJSDate() : null;
      if (eventStart && eventStart < cutoffDate) {
        continue;
      }

      const prefix = calConfig.prefix || '';
      const summary = `${prefix}${event.summary || 'No Title'}`;

      validEvents.push({
        uid: event.uid,
        summary: summary,
        description: event.description,
        location: event.location,
        start: eventStart,
        end: event.endDate ? event.endDate.toJSDate() : null,
        url: event.url
      });
    }

    eventCache[calConfig.id] = validEvents;
    logger.info(`Successfully cached ${validEvents.length} events for [${calConfig.id}]`);
  } catch (error) {
    logger.error(`Failed to fetch calendar [${calConfig.id}]: ${error.message}`);
  }
}

/**
 * Initialize background refresh timers.
 */
function initScheduler() {
  for (const cal of config.calendars) {
    if (!cal.enabled) continue;

    refreshCalendar(cal);

    const intervalSec = cal.refreshIntervalSeconds || 600;
    setInterval(() => refreshCalendar(cal), intervalSec * 1000);
  }
}

/**
 * Authenticated Health Check Endpoint
 * Access format: GET /health?key=YOUR_SECURITY_KEY
 */
app.get('/health', (req, res) => {
  const providedKey = req.query.key;

  if (!providedKey || providedKey !== config.apiKey) {
    logger.warn(`Unauthorized health check access attempt from IP: ${req.ip}`);
    return res.status(401).json({ status: 'unauthorized' });
  }

  const enabledCalendars = config.calendars.filter(c => c.enabled);

  res.json({
    status: 'ok',
    totalConfiguredCalendars: config.calendars.length,
    activeCalendars: enabledCalendars.length,
    cachedSources: Object.keys(eventCache).length,
    timestamp: new Date().toISOString()
  });
});

/**
 * Combined Calendar Endpoint
 * Access format: GET /calendar.ics?key=YOUR_SECURITY_KEY
 */
app.get('/calendar.ics', (req, res) => {
  const providedKey = req.query.key;

  if (!providedKey || providedKey !== config.apiKey) {
    logger.warn(`Unauthorized calendar access attempt from IP: ${req.ip}`);
    return res.status(401).send('Unauthorized: Invalid or missing security key.');
  }

  const combinedCal = icalGenerator({ name: 'Aggregated Feed' });

  Object.values(eventCache).forEach(eventList => {
    eventList.forEach(evt => {
      combinedCal.createEvent({
        id: evt.uid,
        start: evt.start,
        end: evt.end,
        summary: evt.summary,
        description: evt.description,
        location: evt.location,
        url: evt.url
      });
    });
  });

  res.writeHead(200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="calendar.ics"'
  });

  return res.end(combinedCal.toString());
});

// Start server
app.listen(PORT, () => {
  logger.info(`Calendar aggregator service running on port ${PORT}`);
  initScheduler();
});