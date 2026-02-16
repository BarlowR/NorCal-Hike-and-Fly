declare module "igc-xc-score/src/foundation.js" {
  export class Point {
    constructor(fixes: any[], index: number);
    distanceEarth(other: Point): number;
  }
}
