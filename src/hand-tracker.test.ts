import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandTracker } from './hand-tracker';

const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vision.resolve },
  HandLandmarker: { createFromOptions: vision.create },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function camera() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn(), readyState: 'live' });
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function videoElement() {
  return Object.assign(new EventTarget(), {
    srcObject: null, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(),
    readyState: 4, currentTime: 1, videoWidth: 640, videoHeight: 480,
  }) as unknown as HTMLVideoElement;
}

describe('HandTracker lifecycle', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let detector: { close: ReturnType<typeof vi.fn>; detectForVideo: ReturnType<typeof vi.fn> };
  const trackers: HandTracker[] = [];

  function build() {
    const video = videoElement();
    const onHands = vi.fn();
    const onStatus = vi.fn();
    const tracker = new HandTracker(video, onHands, onStatus);
    trackers.push(tracker);
    return { tracker, video, onHands, onStatus };
  }

  function tick(time: number) {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    frames = new Map();
    nextFrame = 0;
    detector = { close: vi.fn(), detectForVideo: vi.fn().mockReturnValue({ landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] }) };
    vision.resolve.mockResolvedValue({ wasmLoaderPath: '/models/wasm/vision_wasm_internal.js', wasmBinaryPath: '/models/wasm/vision_wasm_internal.wasm' });
    vision.create.mockResolvedValue(detector);
    getUserMedia = vi.fn().mockResolvedValue(camera().stream);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });

  afterEach(() => {
    trackers.splice(0).forEach((tracker) => tracker.stop());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('requests video only, loads local assets, and releases every resource on stop', async () => {
    const { stream, track } = camera();
    getUserMedia.mockResolvedValue(stream);
    const { tracker, video } = build();
    await tracker.start();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    expect(vision.resolve).toHaveBeenCalledWith('/models/wasm');
    expect(vision.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 2 }));
    expect(video.srcObject).toBe(stream);
    tracker.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(detector.close).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('closes a camera permission result that arrives after stop', async () => {
    const permission = deferred<MediaStream>();
    getUserMedia.mockReturnValue(permission.promise);
    const { tracker, video } = build();
    const pending = tracker.start();
    tracker.stop();
    await pending;
    const { stream, track } = camera();
    permission.resolve(stream);
    await Promise.resolve();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('closes a late model without reactivating a stopped session', async () => {
    const loading = deferred<typeof detector>();
    vision.create.mockReturnValue(loading.promise);
    const { tracker } = build();
    const pending = tracker.start();
    await vi.waitFor(() => expect(vision.create).toHaveBeenCalledOnce());
    tracker.stop();
    await pending;
    loading.resolve(detector);
    await Promise.resolve();
    expect(detector.close).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('reports CPU model failure without silently trying another inference backend', async () => {
    vision.create.mockRejectedValueOnce(new Error('Model unavailable')).mockResolvedValueOnce(detector);
    const { tracker, video, onStatus } = build();
    await expect(tracker.start()).rejects.toThrow(/模型启动失败/);
    expect(vision.create).toHaveBeenCalledOnce();
    expect(vision.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' } }));
    expect(video.srcObject).toBeNull();
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/模型启动失败/));
    expect(frames.size).toBe(0);
  });

  it('caps inference frequency and clears hands when video becomes stale', async () => {
    detector.detectForVideo.mockReturnValue({ landmarks: [[{ x: 0.5, y: 0.5, z: 0 }]], worldLandmarks: [], handedness: [], handednesses: [] });
    const { tracker, video, onHands } = build();
    await tracker.start();
    tick(100);
    video.currentTime = 2;
    tick(110);
    tick(130);
    expect(detector.detectForVideo).toHaveBeenCalledOnce();
    tick(150);
    expect(detector.detectForVideo).toHaveBeenCalledTimes(2);
    tick(1000);
    expect(detector.detectForVideo).toHaveBeenCalledTimes(2);
    expect(onHands).toHaveBeenLastCalledWith([]);
  });

  it('stops camera and inference on a tracker error', async () => {
    const { stream, track } = camera();
    getUserMedia.mockResolvedValue(stream);
    detector.detectForVideo.mockImplementation(() => { throw new Error('WebGL lost'); });
    const { tracker, video, onStatus } = build();
    await tracker.start();
    tick(100);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/识别.*重新/));
    expect(frames.size).toBe(0);
  });

  it('bounds model loading and closes any late model result', async () => {
    const loading = deferred<typeof detector>();
    vision.create.mockReturnValue(loading.promise);
    const { stream, track } = camera();
    getUserMedia.mockResolvedValue(stream);
    const { tracker, onStatus } = build();
    const result = tracker.start().catch((error: unknown) => error);
    await vi.waitFor(() => expect(vision.create).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await result).toBeInstanceOf(Error);
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/超时/));
    expect(track.stop).toHaveBeenCalledOnce();
    loading.resolve(detector);
    await Promise.resolve();
    expect(detector.close).toHaveBeenCalledOnce();
  });

  it('reports camera permission denial with a Chinese recovery action', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const { tracker, onStatus } = build();
    await expect(tracker.start()).rejects.toThrow();
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/权限.*允许/));
    expect(frames.size).toBe(0);
  });

  it('can retry after a synchronous unsupported-environment failure', async () => {
    vi.stubGlobal('isSecureContext', false);
    const { tracker } = build();
    await expect(tracker.start()).rejects.toThrow(/HTTPS/);
    vi.stubGlobal('isSecureContext', true);
    await expect(tracker.start()).resolves.toBeUndefined();
    expect(frames.size).toBe(1);
  });

  it('does not load a model after stop wins the video-play continuation race', async () => {
    const playing = deferred<void>();
    const { tracker, video, onStatus } = build();
    vi.mocked(video.play).mockReturnValue(playing.promise);
    const pending = tracker.start();
    await vi.waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    playing.resolve();
    await Promise.resolve();
    tracker.stop();
    const statusCount = onStatus.mock.calls.length;
    await pending;
    expect(vision.resolve).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledTimes(statusCount);
  });

  it('does not let a stopped session replace the camera of a later start', async () => {
    const oldPermission = deferred<MediaStream>();
    const oldCamera = camera();
    const newCamera = camera();
    getUserMedia.mockReturnValueOnce(oldPermission.promise).mockResolvedValueOnce(newCamera.stream);
    const { tracker, video } = build();
    const oldStart = tracker.start();
    tracker.stop();
    await tracker.start();
    oldPermission.resolve(oldCamera.stream);
    await oldStart;
    await Promise.resolve();
    expect(oldCamera.track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBe(newCamera.stream);
    expect(newCamera.track.stop).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
  });

  it('stops cleanly if the camera disconnects', async () => {
    const { stream, track } = camera();
    getUserMedia.mockResolvedValue(stream);
    const { tracker, onStatus } = build();
    await tracker.start();
    track.dispatchEvent(new Event('ended'));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/摄像头已断开/));
  });
});
