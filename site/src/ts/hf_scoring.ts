import IGCParser from 'igc-parser';
import { solver, scoringRules as scoring } from 'igc-xc-score';
import { analyze } from '../js/analyze_flight';

import { Point } from 'igc-xc-score/src/foundation.js';

function score(igc_file: string) {
  try {
    const flight = IGCParser.parse(igc_file, { lenient: true });

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
    score += (groundDist * 0.5);
    // Triangle Multiplier
    score *= best.opt.scoring.multiplier

    return {best: best, flight: flight, groundDist: groundDist, closed : closed, score : score}
  } catch (e: any) {
    console.error(e);
  }
}
  

export { score }