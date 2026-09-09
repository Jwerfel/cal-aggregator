const express = require('express');
const axios = require('axios');
const ICAL = require('ical.js');
const icalGenerator = require('ical-generator').default;
const config = require('./config.json');

const app = express();
const PORT = process.env.PORT || config.port || 3000;

// In-memory cache for parsed events: { calendarId: [ array of event objects ] }
const eventCache = {};

/**
 * Fetch and parse an ICS feed. Filter events to >= 14 days ago.
 */
async function refreshCalendar(calConfig) {
  if (!calConfig.enabled) return;

  try {
    console.log(`[${new Date().toISOString()}] Refreshing: ${calConfig.id}`);
    const response = await axios.get(calConfig.url, { timeout: 10000 });
    const parsedIcal = ICAL.parse(response.data);
    const comp = new ICAL.Component(parsedIcal);
    const vevents = comp.getAllSubcomponents('vevent');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 14);

    const validEvents = [];

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);

      // Check event start time against cutoff date
      const eventStart = event.startDate ? event.startDate.toJSDate() : null;
      if (eventStart && eventStart < cutoffDate) {
        continue; // Skip events older than 14 days ago
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
    console.log(`[${calConfig.id}] Successfully cached ${validEvents.length} events.`);
  } catch (error) {
    console.error(`[ERROR] Failed to fetch calendar ${calConfig.id}:`, error.message);
  }
}

/**
 * Initialize background refresh timers for each enabled source.
 */
function initScheduler() {
  for (const cal of config.calendars) {
    if (!cal.enabled) continue;

    // Fetch immediately on startup
    refreshCalendar(cal);

    // Default to 10 minutes (600 seconds) if unspecified
    const intervalSec = cal.refreshIntervalSeconds || 600;
    setInterval(() => refreshCalendar(cal), intervalSec * 1000);
  }
}

/**
 * Combined Calendar Endpoint
 * Access format: GET /calendar.ics?key=YOUR_SECURITY_KEY
 */
app.get('/calendar.ics', (req, res) => {
  const providedKey = req.query.key;

  if (!providedKey || providedKey !== config.apiKey) {
    return res.status(401).send('Unauthorized: Invalid or missing security key.');
  }

  const combinedCal = icalGenerator({ name: 'Aggregated Feed' });

  // Merge events from all cached calendars
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

  // Set response headers and send the raw ICS string
  res.writeHead(200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="calendar.ics"'
  });

  return res.end(combinedCal.toString());
});

// Start application
app.listen(PORT, () => {
  console.log(`Calendar aggregator running on port ${PORT}`);
  initScheduler();
});