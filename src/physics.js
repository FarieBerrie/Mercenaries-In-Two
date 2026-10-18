// Moves bodies through the level's boxes. A body is a vertical box: feet at (x, y, z), half-width
// r, height h (lower when crouched), velocity (vx, vy, vz) in metres per second.
import { boxesNear } from './level.js';

const EPS = 0.001;
const STEP_UP = 0.35; // kerbs and low lips are stepped onto rather than blocking

/**
 * One step of movement, one axis at a time. Sets onGround and hitWall ({ nx, nz, box } facing
 * out of whatever was hit, or null).
 */
export function moveBody(level, b, dt) {
  const wasOnGround = b.onGround;
  b.hitWall = null;
  const reach = b.r + Math.abs(b.vx * dt) + Math.abs(b.vz * dt) + 1;
  const boxes = boxesNear(level, b.x - reach, b.x + reach, b.z - reach, b.z + reach);
  const overlapsY = (box) => b.y < box.y1 - EPS && b.y + b.h > box.y0 + EPS;
  const overlapsX = (box) => b.x + b.r > box.x0 && b.x - b.r < box.x1;
  const overlapsZ = (box) => b.z + b.r > box.z0 && b.z - b.r < box.z1;
  const stepUp = (box) => {
    if (!wasOnGround || box.y1 - b.y > STEP_UP || box.y1 - b.y <= 0) return false;
    b.y = box.y1;
    return true;
  };

  b.x += b.vx * dt;
  for (const box of boxes) {
    if (!overlapsY(box) || !overlapsZ(box) || !overlapsX(box) || stepUp(box)) continue;
    if (b.vx > 0) {
      b.x = box.x0 - b.r - EPS;
      b.hitWall = { nx: -1, nz: 0, box };
    } else if (b.vx < 0) {
      b.x = box.x1 + b.r + EPS;
      b.hitWall = { nx: 1, nz: 0, box };
    }
    b.vx = 0;
  }

  b.z += b.vz * dt;
  for (const box of boxes) {
    if (!overlapsY(box) || !overlapsX(box) || !overlapsZ(box) || stepUp(box)) continue;
    if (b.vz > 0) {
      b.z = box.z0 - b.r - EPS;
      b.hitWall = { nx: 0, nz: -1, box };
    } else if (b.vz < 0) {
      b.z = box.z1 + b.r + EPS;
      b.hitWall = { nx: 0, nz: 1, box };
    }
    b.vz = 0;
  }

  const prevY = b.y;
  b.y += b.vy * dt;
  b.onGround = false;
  if (b.vy <= 0) {
    let top = 0;
    for (const box of boxes) {
      if (!overlapsX(box) || !overlapsZ(box)) continue;
      if (box.y1 <= prevY + EPS && box.y1 >= b.y - EPS && box.y1 >= top) top = box.y1;
    }
    if (b.y <= top) {
      b.y = top;
      b.vy = 0;
      b.onGround = true;
    }
  }

  // The edge of the map
  const bd = level.bounds;
  b.x = Math.max(bd.x0 + b.r, Math.min(bd.x1 - b.r, b.x));
  b.z = Math.max(bd.z0 + b.r, Math.min(bd.z1 - b.r, b.z));
}
