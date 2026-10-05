import type { Landmark } from './gesture';

export type FrameSize = { width: number; height: number };

const palmIndices = [0, 5, 9, 13, 17];

/** Project an already-mirrored camera point through centered CSS object-fit: cover. */
export function projectCoverPoint(
  point: { x: number; y: number }, source: FrameSize, viewport: FrameSize,
): { x: number; y: number } | null {
  if (![source.width, source.height, viewport.width, viewport.height]
    .every((dimension) => Number.isFinite(dimension) && dimension > 0)
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  const scale = Math.max(viewport.width / source.width, viewport.height / source.height);
  const width = source.width * scale, height = source.height * scale;
  const x = ((viewport.width - width) / 2 + point.x * width) / viewport.width;
  const y = ((viewport.height - height) / 2 + point.y * height) / viewport.height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Keep source landmarks unchanged so camera cropping cannot distort gesture geometry. */
export function visibleCoverHands(hands: Landmark[][], source: FrameSize, viewport: FrameSize): Landmark[][] {
  return hands.filter((hand) => {
    if (hand.length !== 21 || !Array.from(hand).every((point) => point
      && Number.isFinite(point.x) && Number.isFinite(point.y)
      && (point.z === undefined || Number.isFinite(point.z)))) return false;

    const center = {
      x: 1 - palmIndices.reduce((sum, index) => sum + hand[index].x, 0) / palmIndices.length,
      y: palmIndices.reduce((sum, index) => sum + hand[index].y, 0) / palmIndices.length,
    };
    const projected = projectCoverPoint(center, source, viewport);
    return projected !== null && projected.x >= 0 && projected.x <= 1
      && projected.y >= 0 && projected.y <= 1;
  });
}
