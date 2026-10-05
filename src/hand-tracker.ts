import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from './gesture';

const frameInterval = 1000 / 24;
const staleAfter = 750;

function closeModel(model: HandLandmarker): void {
  try { model.close(); } catch { /* A failed runtime may already be disposed. */ }
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

/** Bound browser/model promises that cannot themselves be cancelled. */
function bounded<T>(operation: Promise<T>, signal: AbortSignal, milliseconds: number, message: string, disposeLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      if (settled) return;
      finish();
      reject(new DOMException('启动已取消', 'AbortError'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      const error = new Error(message);
      error.name = 'TimeoutError';
      reject(error);
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    operation.then((value) => {
      if (settled) { disposeLate?.(value); return; }
      finish();
      resolve(value);
    }, (error: unknown) => {
      if (settled) return;
      finish();
      reject(error);
    });
    if (signal.aborted) abort();
  });
}

function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '摄像头权限未开启：请在地址栏允许摄像头访问，然后重新启动。';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '未找到摄像头：请连接摄像头后重新启动，也可先使用演示模式。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '摄像头无法读取：请关闭占用摄像头的其他应用，然后重新启动。';
  if (name === 'TimeoutError') return error instanceof Error ? error.message : '启动超时：请重新启动。';
  if (error instanceof Error && error.message.startsWith('当前')) return error.message;
  return '手势模型启动失败：请检查本地模型文件，刷新页面后重新启动。';
}

export class HandTracker {
  private stream: MediaStream | null = null;
  private model: HandLandmarker | null = null;
  private controller: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private frame: number | null = null;
  private generation = 0;
  private lastInference = -Infinity;
  private lastVideoTime = -1;
  private lastFreshFrame = 0;
  private staleCleared = false;
  private removeTrackListeners: (() => void)[] = [];

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onHands: (hands: Landmark[][]) => void,
    private readonly onStatus: (message: string) => void,
  ) {}

  start(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.model) return Promise.resolve();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const pending = this.initialize(generation, controller.signal).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  stop(): void {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.removeTrackListeners.splice(0).forEach((remove) => remove());
    if (this.stream) stopStream(this.stream);
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    if (this.model) closeModel(this.model);
    this.model = null;
    this.onHands([]);
  }

  private async initialize(generation: number, signal: AbortSignal): Promise<void> {
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前环境不支持摄像头：请使用 HTTPS 或 localhost，并在支持摄像头的浏览器中打开。');
      }
      this.onStatus('正在请求摄像头权限…');
      const stream = await bounded(navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
      }), signal, 30_000, '摄像头授权超时：请允许摄像头权限，然后重新启动。', stopStream);
      if (signal.aborted) { stopStream(stream); return; }
      this.stream = stream;
      this.video.srcObject = stream;
      stream.getTracks().forEach((track) => {
        const ended = () => {
          if (this.generation !== generation) return;
          this.stop();
          this.onStatus('摄像头已断开：请检查设备连接，然后重新启动。');
        };
        track.addEventListener('ended', ended);
        this.removeTrackListeners.push(() => track.removeEventListener('ended', ended));
      });
      await bounded(this.video.play(), signal, 10_000, '摄像头画面加载超时：请检查设备后重新启动。');
      if (signal.aborted) return;
      this.onStatus('正在加载本地手势模型…');
      const fileset = await bounded(FilesetResolver.forVisionTasks('/models/wasm'), signal, 20_000, '手势运行时加载超时：请检查本地模型资源后重新启动。');
      if (signal.aborted) return;
      // CPU avoids browser/GPU combinations that initialize successfully but
      // silently produce empty detections. Rendering remains independent.
      const model = await bounded(HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      }), signal, 20_000, '手势模型加载超时：请检查本地模型资源，刷新后重新启动。', closeModel);
      if (signal.aborted) { closeModel(model); return; }
      this.model = model;
      this.lastInference = -Infinity;
      this.lastVideoTime = -1;
      this.lastFreshFrame = performance.now();
      this.staleCleared = false;
      this.onStatus('摄像头已连接 · 手势在本地识别');
      this.frame = requestAnimationFrame((timestamp) => this.detect(timestamp, generation));
    } catch (error) {
      if (signal.aborted) return;
      this.stop();
      const message = describeError(error);
      this.onStatus(message);
      throw new Error(message, { cause: error });
    }
  }

  private detect(timestamp: number, generation: number): void {
    if (generation !== this.generation || !this.model) return;
    this.frame = null;
    try {
      if (timestamp - this.lastInference >= frameInterval) {
        if (this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.currentTime !== this.lastVideoTime) {
          this.lastVideoTime = this.video.currentTime;
          this.lastInference = timestamp;
          this.lastFreshFrame = timestamp;
          this.staleCleared = false;
          const result = this.model.detectForVideo(this.video, timestamp);
          this.onHands(result.landmarks);
        } else if (!this.staleCleared && timestamp - this.lastFreshFrame > staleAfter) {
          this.staleCleared = true;
          this.onHands([]);
        }
      }
      if (generation === this.generation) this.frame = requestAnimationFrame((time) => this.detect(time, generation));
    } catch {
      this.stop();
      this.onStatus('手势识别中断：请重新启动摄像头，也可切换演示模式。');
    }
  }
}
