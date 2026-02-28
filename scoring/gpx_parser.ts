import type IGCParser from 'igc-parser';

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`));
  return match ? match[1].trim() : null;
}

export function parseGpx(xmlText: string): IGCParser.IGCFile {
  const trkptRe = /<trkpt\s([^>]*)>([\s\S]*?)<\/trkpt>/g;
  const fixes: IGCParser.BRecord[] = [];
  let match;

  while ((match = trkptRe.exec(xmlText)) !== null) {
    const attrs = match[1];
    const content = match[2];

    const latMatch = attrs.match(/lat=["']([^"']+)["']/);
    const lonMatch = attrs.match(/lon=["']([^"']+)["']/);
    const time = extractTag(content, 'time');
    const ele = extractTag(content, 'ele');

    if (!latMatch || !lonMatch || !time) continue;

    const lat = parseFloat(latMatch[1]);
    const lon = parseFloat(lonMatch[1]);
    const timestamp = new Date(time).getTime();

    if (isNaN(lat) || isNaN(lon) || isNaN(timestamp)) continue;

    const alt = ele ? parseFloat(ele) : null;
    fixes.push({
      timestamp,
      time,
      latitude: lat,
      longitude: lon,
      valid: true,
      pressureAltitude: alt,
      gpsAltitude: alt,
      extensions: {},
      fixAccuracy: null,
      enl: null,
    });
  }

  if (fixes.length === 0) throw new Error('No track points found in GPX file');

  fixes.sort((a, b) => a.timestamp - b.timestamp);

  // Smooth GPS altitude with a 30-second centered moving average.
  // Raw GPS elevation can be noisy (±2–5 m), which creates large apparent vertical
  // speeds. Smoothing gives more accurate vspeed for flight detection.
  const HALF_WIN = 15_000;
  const smoothed = fixes.map((fix, i) => {
    let sum = 0, count = 0;
    for (let j = 0; j < fixes.length; j++) {
      const alt = fixes[j].gpsAltitude;
      if (alt !== null && Math.abs(fixes[j].timestamp - fix.timestamp) <= HALF_WIN) {
        sum += alt;
        count++;
      }
    }
    const alt = count > 0 ? sum / count : fix.gpsAltitude;
    return { ...fix, gpsAltitude: alt, pressureAltitude: alt };
  });

  return {
    date: new Date(fixes[0].timestamp).toISOString().split('T')[0],
    numFlight: null,
    pilot: null,
    copilot: null,
    gliderType: null,
    registration: null,
    callsign: null,
    competitionClass: null,
    site: null,
    loggerId: null,
    loggerManufacturer: '',
    loggerType: null,
    firmwareVersion: null,
    hardwareVersion: null,
    task: null,
    fixes: smoothed,
    dataRecords: [],
    security: null,
    errors: [],
  };
}
