import IGCParser from 'igc-parser';
import { parseGpx } from './gpx_parser.js';

export interface ParsedFix {
  latitude: number;
  longitude: number;
  gpsAltitude: number;
  timestamp: number;
  onGround: boolean;
}

export function parseFixes(content: string): ParsedFix[] {
  const isGpx = content.trimStart().startsWith('<');
  const flight = (isGpx
    ? parseGpx(content)
    : IGCParser.parse(content, { lenient: true })) as any;

  return flight.fixes.map((f: any) => ({
    latitude: f.latitude,
    longitude: f.longitude,
    gpsAltitude: f.gpsAltitude ?? f.pressureAltitude ?? 0,
    timestamp: f.timestamp,
    onGround: true,
  }));
}
