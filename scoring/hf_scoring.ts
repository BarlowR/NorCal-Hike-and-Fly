import IGCParser from 'igc-parser';
import { solver, scoringRules as scoring } from 'igc-xc-score';
import { analyze } from './analyze_flight.js';
import { parseGpx } from './gpx_parser.js';
import { Point } from 'igc-xc-score/src/foundation.js';
export const COMPETITION_START_HOUR = 8;   // 8:00 AM local
export const COMPETITION_END_HOUR   = 17;  // 5:00 PM local

/**
 * Parse the HFTZNTIMEZONE header from an IGC file and return an Etc/GMT
 * timezone string (e.g. "Etc/GMT+7" for UTC-7), or null if not present.
 */
export function igcTimeZone(content: string): string | null {
    const match = content.match(/^HFTZNTIMEZONE:\s*([+-]?\d+(?:\.\d+)?)/m);
    if (!match) return null;
    const hours = parseFloat(match[1]);
    // Etc/GMT sign is inverted: UTC-7 → Etc/GMT+7
    const sign = hours >= 0 ? '-' : '+';
    return `Etc/GMT${sign}${Math.abs(Math.round(hours))}`;
}

/**
 * Filter fixes to only those whose local hour falls within [startHour, endHour).
 */
export function filterByTimeWindow<T extends { timestamp: number }>(
    fixes: T[],
    timeZone: string,
    startHour: number,
    endHour: number,
): T[] {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        hour: 'numeric',
    });
    return fixes.filter(fix => {
        const parts = fmt.formatToParts(new Date(fix.timestamp));
        const h = parseInt(parts.find((p: Intl.DateTimeFormatPart) => p.type === 'hour')!.value);
        return h >= startHour && h < endHour;
    });
}

async function getTimezone(lat: number, lon: number): Promise<string> {
    try {
        const res = await fetch(`https://timeapi.io/api/timezone/coordinate?latitude=${lat}&longitude=${lon}`);
        const data = (await res.json()) as { timeZone: string };
        return data.timeZone;
    } catch {
        // Fallback to longitude estimate
        const offset = Math.round(lon / 15);
        return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
    }
}

export async function scoreTrack(file_contents: string) {
    try {
        const isGpx = file_contents.trimStart().startsWith('<');
        const flight = (isGpx
            ? parseGpx(file_contents)
            : IGCParser.parse(file_contents, { lenient: true })) as any;

        // Determine timezone and filter fixes to 8am–5pm local time.
        const tz = !isGpx ? igcTimeZone(file_contents) : null;
        const timeZone = tz ?? await (async () => {
            const validFix = flight.fixes.find((f: any) => f.latitude !== 0 || f.longitude !== 0)
                ?? flight.fixes[0];
            return getTimezone(validFix.latitude, validFix.longitude);
        })();

        const initialLength = flight.fixes.length;
        console.log(`  Timezone: ${timeZone}`);
        console.log(`  Total fixes: ${initialLength}`);
        console.log(`  First fix UTC: ${new Date(flight.fixes[0].timestamp).toISOString()}`);

        flight.fixes = filterByTimeWindow(flight.fixes, timeZone, COMPETITION_START_HOUR, COMPETITION_END_HOUR);

        const filteredLength = flight.fixes.length;
        let filteredByTime = false;
        if (filteredLength < initialLength)
            filteredByTime = true;
        console.log(`  Fixes after time filter: ${filteredLength} (removed ${initialLength - filteredLength})`);

        const triangleScoringRules = (scoring as any).XContest
            .filter((r: any) => r.code === 'tri' || r.code === 'fai')
            .map((r: any) => ({
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
            if (next)
                best = next;
            else
                break;
            cycles++;
        }

        analyze(flight, { analyze: true });
        const fixes = flight.filtered || flight.fixes;
        const triangleDist = best.scoreInfo?.distance ?? 0;
        const penalty = best.scoreInfo?.penalty ?? 0;
        let closed = (triangleDist * 0.2) > penalty;
        const onGroundCount = fixes.filter((f: any) => f.onGround).length;
        console.log(`  Filtered fixes: ${fixes.length}, onGround=true: ${onGroundCount}`);

        let groundDist = 0;
        let hikingElevationGain = 0;
        let lastGroundAlt: number | null = null;
        let filter_window = 5;
        for (let i = filter_window; i < fixes.length - filter_window; i += filter_window) {
            if (fixes[i].onGround) {
                const dist = (new Point(fixes, i - filter_window).distanceEarth(new Point(fixes, i)));
                groundDist += dist;
                const alt: number | null = fixes[i].pressureAltitude ?? fixes[i].gpsAltitude;
                if (alt !== null) {
                    if (lastGroundAlt !== null && alt > lastGroundAlt) {
                        hikingElevationGain += alt - lastGroundAlt;
                    }
                    lastGroundAlt = alt;
                }
            } else {
                lastGroundAlt = null;
            }
        }

        let score = 0;
        // Full triangle
        score += triangleDist;
        // Closing Penalty
        score -= (penalty * 2);
        // Hiking Bonus
        score += (groundDist);
        // Triangle Multiplier — use correct multiplier based on triangle
        // type and our custom closing threshold (20% of perimeter distance).
        // We can't use best.opt.scoring.multiplier directly because the solver
        // uses a different threshold.
        const triangleCode = best.opt.scoring.code;
        const multiplier = triangleCode === 'fai'
            ? (closed ? 1.6 : 1.4)
            : (closed ? 1.4 : 1.2);
        score *= multiplier;

        console.log(`  Scoring: tri=${triangleDist.toFixed(2)} penalty=${penalty.toFixed(2)} ground=${groundDist.toFixed(2)} mult=${multiplier} closed=${closed}`);
        console.log(`  Final score: ${score.toFixed(2)} (optimal=${best.optimal}, cycles=${cycles})`);

        return { best: best, flight: flight, groundDist: groundDist, hikingElevationGain: hikingElevationGain, closed: closed, score: score, filteredByTime: filteredByTime };
    } catch (e) {
        console.error(e);
    }
}
