/**
 * Compact, display-only representation of a track for the flights map and
 * elevation chart.
 *
 * The site originally rendered a flight by downloading the raw IGC/GPX source
 * (up to ~7 MB, served uncompressed from r2.dev), parsing it in the browser,
 * looking up the timezone (an extra timeapi.io round trip for GPX), filtering
 * to the contest window and applying the stored flight segments. The pipeline
 * now does that work once and stores the result in trackData.display, so the
 * browser only fetches the small track JSON.
 *
 * Encoding (v1): every fix the old client path would have drawn, in order,
 * no decimation.
 *   lat, lon: delta-encoded integers in 1e-5 degrees (~1 m)
 *   alt:      delta-encoded integers in 0.1 m
 *   ground:   run lengths of alternating onGround state, starting with
 *             onGround = true (the first run may be 0 if the track starts airborne)
 *
 * Fixes at exactly (0, 0) are invalid GPS records; the map drops them anyway,
 * so they are omitted here.
 */

import { parseFixes } from './parseFixes.js';
import { filterByTimeWindow, COMPETITION_START_HOUR, COMPETITION_END_HOUR } from './hf_scoring.js';

export interface DisplayTrack {
    v: 1;
    lat: number[];
    lon: number[];
    alt: number[];
    ground: number[];
}

export interface DisplayFix {
    latitude: number;
    longitude: number;
    gpsAltitude: number;
    onGround: boolean;
}

export interface FlightSegment {
    takeoffMs: number;
    landingMs: number;
}

/** Mark fixes inside any [takeoffMs, landingMs] segment as airborne (in place). */
export function applyFlightSegments<T extends { timestamp: number; onGround: boolean }>(
    fixes: T[],
    segments: FlightSegment[],
): T[] {
    for (const seg of segments) {
        for (const fix of fixes) {
            if (fix.timestamp >= seg.takeoffMs && fix.timestamp <= seg.landingMs) {
                fix.onGround = false;
            }
        }
    }
    return fixes;
}

/**
 * The fixes the flights page displays for a source file: parsed, filtered to
 * the contest window in `timeZone` (skipped when null), with flight segments applied.
 */
export function displayFixesFromSource(
    content: string,
    timeZone: string | null,
    segments: FlightSegment[],
): DisplayFix[] {
    let fixes = parseFixes(content);
    if (timeZone) fixes = filterByTimeWindow(fixes, timeZone, COMPETITION_START_HOUR, COMPETITION_END_HOUR);
    return applyFlightSegments(fixes, segments);
}

export function encodeDisplayTrack(fixes: DisplayFix[]): DisplayTrack {
    const lat: number[] = [], lon: number[] = [], alt: number[] = [], ground: number[] = [];
    let pLat = 0, pLon = 0, pAlt = 0;
    let state = true, run = 0;
    for (const f of fixes) {
        if (f.latitude === 0 && f.longitude === 0) continue;
        const qLat = Math.round(f.latitude * 1e5);
        const qLon = Math.round(f.longitude * 1e5);
        const qAlt = Math.round((f.gpsAltitude ?? 0) * 10);
        lat.push(qLat - pLat);
        lon.push(qLon - pLon);
        alt.push(qAlt - pAlt);
        pLat = qLat; pLon = qLon; pAlt = qAlt;
        if (f.onGround !== state) {
            ground.push(run);
            state = f.onGround;
            run = 0;
        }
        run++;
    }
    if (run > 0) ground.push(run);
    return { v: 1, lat, lon, alt, ground };
}

export function decodeDisplayTrack(d: DisplayTrack): DisplayFix[] {
    const n = d.lat.length;
    const fixes: DisplayFix[] = new Array(n);
    let qLat = 0, qLon = 0, qAlt = 0;
    let runIdx = 0, runLeft = d.ground[0] ?? n, state = true;
    for (let i = 0; i < n; i++) {
        while (runLeft === 0 && runIdx < d.ground.length - 1) {
            runIdx++;
            runLeft = d.ground[runIdx];
            state = !state;
        }
        qLat += d.lat[i];
        qLon += d.lon[i];
        qAlt += d.alt[i];
        fixes[i] = { latitude: qLat / 1e5, longitude: qLon / 1e5, gpsAltitude: qAlt / 10, onGround: state };
        runLeft--;
    }
    return fixes;
}
