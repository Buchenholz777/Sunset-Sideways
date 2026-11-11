import { BALANCE as B } from '../config/balance';
import type { Road } from './road';
import { KINDS, type Obstacle, type Pickup } from './world';

export interface Footprint {
  x: number;
  z: number;
  yaw: number;
  halfWidth: number;
  halfLength: number;
}

export function playerFootprint(x: number, frontZ: number, yaw: number): Footprint {
  const p = B.player;
  return {
    x: x - Math.sin(yaw) * p.len / 2,
    z: frontZ - Math.cos(yaw) * p.len / 2,
    yaw,
    halfWidth: p.width / 2 - p.hitInsetX,
    halfLength: p.len / 2 - p.hitInsetZ,
  };
}

export function obstacleFootprint(road: Road, o: Obstacle, rearZ = o.z): Footprint {
  const kind = KINDS[o.kind];
  const yaw = Math.atan(road.heading(rearZ));
  return {
    x: road.center(rearZ) + o.x + Math.sin(yaw) * kind.len / 2,
    z: rearZ + Math.cos(yaw) * kind.len / 2,
    yaw,
    halfWidth: kind.w / 2 - B.obstacle.hitInset,
    halfLength: kind.len / 2 - B.obstacle.hitInset,
  };
}

export function pickupFootprint(road: Road, p: Pickup): Footprint {
  return { x: road.center(p.z) + p.x, z: p.z, yaw: Math.atan(road.heading(p.z)), halfWidth: B.pickup.width / 2, halfLength: B.pickup.len / 2 };
}

export function bodyPoint(body: Footprint, across: number, along: number): [number, number] {
  const c = Math.cos(body.yaw), s = Math.sin(body.yaw);
  return [body.x + across * c + along * s, body.z - across * s + along * c];
}

export function footprintCorners(body: Footprint): [number, number][] {
  const { halfWidth: w, halfLength: l } = body;
  return [bodyPoint(body, -w, -l), bodyPoint(body, w, -l), bodyPoint(body, w, l), bodyPoint(body, -w, l)];
}

/** Zeitintervall, in dem sich eine linear bewegte Koordinate im Intervall befindet. */
export function overlapInterval(r0: number, r1: number, lo: number, hi: number): [number, number] | null {
  if (r0 === r1) return r0 >= lo && r0 <= hi ? [0, 1] : null;
  const d = r1 - r0;
  const a = (lo - r0) / d, b = (hi - r0) / d;
  const from = Math.max(0, Math.min(a, b)), to = Math.min(1, Math.max(a, b));
  return from <= to ? [from, to] : null;
}

/** Swept SAT. Alle vier Trennachsen müssen zur selben Zeit überlappen. */
export function contactTime(a0: Footprint, a1: Footprint, b0: Footprint, b1: Footprint): number | null {
  const x0 = a0.x - b0.x, z0 = a0.z - b0.z;
  const x1 = a1.x - b1.x, z1 = a1.z - b1.z;
  const radiusA = Math.hypot(a0.halfWidth, a0.halfLength);
  const radiusB = Math.hypot(b0.halfWidth, b0.halfLength);
  const radius = radiusA + radiusB;
  if (!overlapInterval(x0, x1, -radius, radius) || !overlapInterval(z0, z1, -radius, radius)) return null;

  const da = a1.yaw - a0.yaw, db = b1.yaw - b0.yaw;
  // Innerhalb eines Winkelteilschritts deckt der Zuschlag die Bewegung einer Ecke ab.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(da), Math.abs(db)) / 0.02));
  const padding = (radiusA * Math.abs(da) + radiusB * Math.abs(db)) / (2 * steps);
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps, mid = (t0 + t1) / 2;
    const yawA = a0.yaw + da * mid, yawB = b0.yaw + db * mid;
    let from = 0, to = 1;
    for (const axis of [yawA, yawA + Math.PI / 2, yawB, yawB + Math.PI / 2]) {
      const bound = padding
        + a0.halfWidth * Math.abs(Math.cos(yawA - axis)) + a0.halfLength * Math.abs(Math.sin(yawA - axis))
        + b0.halfWidth * Math.abs(Math.cos(yawB - axis)) + b0.halfLength * Math.abs(Math.sin(yawB - axis));
      const start = x0 * Math.cos(axis) - z0 * Math.sin(axis);
      const end = x1 * Math.cos(axis) - z1 * Math.sin(axis);
      const interval = overlapInterval(start + (end - start) * t0, start + (end - start) * t1, -bound, bound);
      if (!interval) { from = 1; to = 0; break; }
      from = Math.max(from, interval[0]);
      to = Math.min(to, interval[1]);
      if (from > to) break;
    }
    if (from <= to) return t0 + (t1 - t0) * from;
  }
  return null;
}
