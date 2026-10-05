export type Landmark = { x: number; y: number; z?: number };

export interface GestureReading {
  x: number;
  y: number;
  expansion: number;
  openness: number;
  handCount: number;
}

const palmIndices = [0, 5, 9, 13, 17];
const fingerBases = [5, 9, 13, 17];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

function validHand(hand: Landmark[]): boolean {
  return hand.length === 21
    && hand.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.z === undefined || Number.isFinite(point.z)))
    && distance(hand[0], hand[9]) > 0.0001
    && fingerBases.every((base) => distance(hand[base], hand[base + 1]) > 0.00001);
}

function openness(hand: Landmark[]): number {
  const palmLength = distance(hand[0], hand[9]);
  return fingerBases.reduce((sum, base) => {
    const [knuckle, joint, distal, tip] = hand.slice(base, base + 4);
    // The joint bend and wrist-to-tip reach use local distances rather than
    // screen-up comparisons, so a sideways or smaller hand behaves the same.
    const firstBone = distance(knuckle, joint);
    const secondBone = distance(joint, distal);
    const cosine = secondBone > 0.00001
      ? ((joint.x - knuckle.x) * (distal.x - joint.x)
        + (joint.y - knuckle.y) * (distal.y - joint.y)
        + ((joint.z ?? 0) - (knuckle.z ?? 0)) * ((distal.z ?? 0) - (joint.z ?? 0))) / (firstBone * secondBone)
      : -1;
    const straightness = clamp((cosine + 0.2) / 1.05);
    const reach = clamp((distance(hand[0], tip) - distance(hand[0], knuckle)) / palmLength / 0.9);
    return sum + straightness * 0.6 + reach * 0.4;
  }, 0) / fingerBases.length;
}

/** Convert local MediaPipe landmarks to a mirrored, normalized visual control. */
export function analyzeHands(hands: Landmark[][]): GestureReading | null {
  const valid = hands.filter(validHand).slice(0, 2);
  if (valid.length === 0) return null;
  const centers = valid.map((hand) => ({
    x: palmIndices.reduce((sum, index) => sum + hand[index].x, 0) / palmIndices.length,
    y: palmIndices.reduce((sum, index) => sum + hand[index].y, 0) / palmIndices.length,
  }));
  const open = valid.reduce((sum, hand) => sum + openness(hand), 0) / valid.length;
  const separation = centers.length === 2 ? distance(centers[0], centers[1]) : 0;
  return {
    x: clamp(1 - centers.reduce((sum, point) => sum + point.x, 0) / centers.length),
    y: clamp(centers.reduce((sum, point) => sum + point.y, 0) / centers.length),
    expansion: centers.length === 2 ? clamp((separation - 0.12) / 0.6) : clamp(open),
    openness: clamp(open),
    handCount: valid.length,
  };
}
