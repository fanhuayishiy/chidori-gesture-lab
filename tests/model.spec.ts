import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { GestureReading, Landmark } from '../src/gesture';

test('actual local MediaPipe model distinguishes public fist and open-palm fixtures', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const fixtures = await Promise.all(['fist.jpg', 'right_hands.jpg'].map(async (name) => ({
    name,
    dataUrl: `data:image/jpeg;base64,${(await readFile(new URL(`./fixtures/${name}`, import.meta.url))).toString('base64')}`,
  })));
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:5173/')) externalRequests.push(url);
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#lightning')).toBeVisible();

  const results = await page.evaluate(async (inputs) => {
    const runtimeUrl = '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
    const gestureUrl = '/src/gesture.ts';
    const { FilesetResolver, HandLandmarker } = await import(runtimeUrl);
    const { analyzeHands } = await import(gestureUrl);
    const fileset = await FilesetResolver.forVisionTasks('/models/wasm');
    const detector = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' },
      runningMode: 'IMAGE', numHands: 2,
      minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
    const board = document.createElement('section');
    board.id = 'inference-evidence';
    board.style.cssText = 'position:absolute;top:0;left:0;width:1320px;padding:32px;box-sizing:border-box;background:#08121e;color:#eef5ff;z-index:99999;font:16px monospace;display:flex;gap:24px;flex-wrap:wrap';
    const heading = document.createElement('h1');
    heading.style.cssText = 'width:100%;font-size:24px;margin:0';
    heading.textContent = 'LOCAL MEDIAPIPE · Actual IMAGE inference · CPU / WASM';
    board.append(heading);
    document.body.append(board);
    const findings: { fixture: string; hands: Landmark[][]; reading: GestureReading | null; individualReadings: (GestureReading | null)[] }[] = [];
    const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
    try {
      for (const input of inputs) {
        const image = new Image();
        image.src = input.dataUrl;
        await image.decode();
        const result = detector.detect(image);
        const hands = result.landmarks as Landmark[][];
        const reading = analyzeHands(hands) as GestureReading | null;
        const individualReadings = hands.map((hand) => analyzeHands([hand]) as GestureReading | null);
        findings.push({ fixture: input.name, hands, reading, individualReadings });
        const figure = document.createElement('figure');
        figure.style.cssText = 'margin:0;width:616px';
        const caption = document.createElement('figcaption');
        caption.style.cssText = 'margin-bottom:16px;line-height:1.6;white-space:pre-wrap';
        caption.textContent = `${input.name} | ${hands.length} hand(s)\nopenness: ${individualReadings.map((item) => item?.openness.toFixed(3)).join(', ')} | expansion: ${reading?.expansion.toFixed(3)}`;
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.style.cssText = 'width:100%;height:auto;display:block;background:#fff';
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        hands.forEach((hand, handIndex) => {
          context.strokeStyle = handIndex === 0 ? '#00cc8d' : '#007eff';
          context.lineWidth = Math.max(2, canvas.width / 160);
          connections.forEach(([from, to]) => {
            context.beginPath();
            context.moveTo(hand[from].x * canvas.width, hand[from].y * canvas.height);
            context.lineTo(hand[to].x * canvas.width, hand[to].y * canvas.height);
            context.stroke();
          });
          hand.forEach((point) => {
            context.beginPath();
            context.fillStyle = '#ff2d65';
            context.arc(point.x * canvas.width, point.y * canvas.height, Math.max(2.5, canvas.width / 120), 0, Math.PI * 2);
            context.fill();
          });
        });
        figure.append(caption, canvas);
        board.append(figure);
      }
      return findings;
    } finally {
      detector.close();
    }
  }, fixtures);

  await page.locator('#inference-evidence').screenshot({ path: fileURLToPath(new URL('./fixtures/inference-landmarks.png', import.meta.url)) });
  await testInfo.attach('actual-inference.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  console.log('ACTUAL_MODEL_INFERENCE', JSON.stringify(results.map(({ fixture, hands, reading, individualReadings }) => ({ fixture, landmarksPerHand: hands.map((hand) => hand.length), reading, individualReadings }))));
  expect(externalRequests).toEqual([]);
  const fist = results.find((item) => item.fixture === 'fist.jpg')!;
  const palms = results.find((item) => item.fixture === 'right_hands.jpg')!;
  expect(fist.hands).toHaveLength(1);
  expect(fist.hands[0]).toHaveLength(21);
  expect(fist.reading).not.toBeNull();
  expect(fist.reading!.openness).toBeLessThan(0.25);
  expect(fist.reading!.expansion).toBeLessThan(0.25);
  expect(palms.hands).toHaveLength(2);
  expect(palms.hands.every((hand) => hand.length === 21)).toBe(true);
  expect(palms.individualReadings.every((reading) => reading !== null && reading.openness > 0.8)).toBe(true);
});
