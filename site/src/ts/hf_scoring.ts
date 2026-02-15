import IGCParser from 'igc-parser';
import { solver, scoringRules as scoring } from 'igc-xc-score';
import { analyze } from '../js/analyze_flight';


import { Point } from 'igc-xc-score/src/foundation.js';

async function getTimezone(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://timeapi.io/api/timezone/coordinate?latitude=${lat}&longitude=${lon}`
    );
    const data = await res.json();
    return data.timeZone;
  } catch {
    // Fallback to longitude estimate
    const offset = Math.round(lon / 15);
    return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
  }
}

async function score(igc_file: string) {
  try {
    const flight = IGCParser.parse(igc_file, { lenient: true });

    // Get timezone from flight location
    const lat = flight.fixes[0].latitude;
    const lon = flight.fixes[0].longitude;
    const timeZone = await getTimezone(lat, lon);

    const initialLength = flight.fixes.length;
    // Filter fixes to 8am - 5pm local time
    flight.fixes = flight.fixes.filter(fix => {
      const localHour = parseInt(
        new Date(fix.timestamp).toLocaleString('en-US', {
          timeZone,
          hour: 'numeric',
          hour12: false,
        })
      );
      return localHour >= 8 && localHour < 17;
    });
    const filteredLength = flight.fixes.length;
    let filteredByTime = false;
    if (filteredLength < initialLength) filteredByTime = true;

    const triangleScoringRules = scoring.XContest
      .filter(r => r.code === 'tri' || r.code === 'fai')
      .map(r => ({
          ...r,
          closingDistanceRelative: 0.8,
          closingDistanceFree: 0,
          closingDistanceFixed: 0,
    }));
    const gen = solver(flight, triangleScoringRules);
    let best = gen.next().value;

    // Iterate until optimal or 100 cycles
    let cycles = 0;
    while (!best.optimal && cycles < 100) {
      const next = gen.next().value;
      if (next) best = next;
      else break;
      cycles++;
    }

    analyze(flight, {analyze : true});

    let closed = (best.scoreInfo?.distance * 0.2) > (best.scoreInfo?.penalty)

    let groundDist = 0;
    let filter_window = 5; 
    for (let i = filter_window; i < flight.fixes.length - filter_window; i+=filter_window) {
      if (flight.fixes[i].onGround) { 
        const dist = (new Point(flight.fixes, i - filter_window).distanceEarth(new Point(flight.fixes, i)));
        groundDist += dist;
      }
    }

    let score = 0; 
    // Full triangle
    score += best.scoreInfo?.distance;
    // Closing Penalty
    score -= (best.scoreInfo?.penalty * 2);
    // Hiking Bonus
    score += (groundDist);
    // Triangle Multiplier
    score *= best.opt.scoring.multiplier

    return {best: best, flight: flight, groundDist: groundDist, closed : closed, score : score, filteredByTime : filteredByTime}
  } catch (e: any) {
    console.error(e);
  }
}
  

export { score }