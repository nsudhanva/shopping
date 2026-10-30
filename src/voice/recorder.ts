// Microphone capture for voice commands. It sets speech constraints, measures the level and finds the end of speech.

// The app uses the first supported type: Opus in WebM (Chrome, Edge, Firefox), AAC in MP4 (Safari)
// or Opus in Ogg (older Firefox).
const preferredTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];
// Opus at 48 kbps mono keeps the full speech quality and keeps uploads small.
const audioBitsPerSecond = 48_000;

const speechLevel = 0.015; // An RMS level above this is speech (after auto gain).
const silentPeak = 0.008; // If the peak stays below this level, the recording has no speech.
// Speech must continue this long before a pause can end the recording. Clicks and breaths are shorter.
const minSpeechMs = 300;
// A pause of this length ends the command. A shorter pause, as in "milk... and eggs", does not.
const endOfSpeechMs = 1800;
const noSpeechMs = 8000; // Stop if no speech starts in this time.
const maxRecordingMs = 30_000;

export type RecordingResult = { blob: Blob; mimeType: string } | { silent: true };

export type Recording = {
  /** Stops the recording, releases the microphone and returns the audio. */
  stop: () => Promise<RecordingResult>;
  /** Stops the recording, releases the microphone and discards the audio. */
  cancel: () => void;
};

export class MicrophoneError extends Error {
  constructor(readonly reason: "denied" | "missing" | "unsupported" | "failed") {
    super(reason);
  }
}

function toMicrophoneError(error: unknown): MicrophoneError {
  const name = (error as { name?: string }).name;
  if (name === "NotAllowedError" || name === "SecurityError") return new MicrophoneError("denied");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new MicrophoneError("missing");
  return new MicrophoneError("failed");
}

/**
 * Starts to record when the microphone is live. `onLevel` gets a value from 0 to 1 for the meter.
 * `onEndOfSpeech` fires one time, after a pause that follows speech or at the length limit.
 */
export async function startRecording(callbacks: {
  onLevel: (level: number) => void;
  onEndOfSpeech: () => void;
}): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new MicrophoneError("unsupported");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (error) {
    throw toMicrophoneError(error);
  }

  const stopTracks = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond });
  } catch (error) {
    stopTracks();
    throw toMicrophoneError(error);
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const meter = await startMeter(stream, callbacks);
  const release = () => {
    meter.stop();
    stopTracks();
  };
  try {
    recorder.start();
  } catch (error) {
    release();
    throw toMicrophoneError(error);
  }

  return {
    stop: () =>
      new Promise<RecordingResult>((resolve) => {
        recorder.onstop = () => {
          release();
          // Use the "silent" result only when the meter was on.
          if (meter.active && meter.peak() < silentPeak) {
            resolve({ silent: true });
            return;
          }
          const type = recorder.mimeType || mimeType || "audio/webm";
          resolve({ blob: new Blob(chunks, { type }), mimeType: type });
        };
        if (recorder.state === "inactive") recorder.onstop(new Event("stop"));
        else recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}

type Meter = { active: boolean; peak: () => number; stop: () => void };

// Returns null when the meter cannot measure. The audio context can stay suspended because the user
// activation from the tap expired (then resume() never settles). Or the browser can reject the track
// (Firefox does this for a sample-rate mismatch on some Bluetooth headsets). Recording works without the meter.
async function connectAnalyser(stream: MediaStream) {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return null;
  }
  await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, 300))]);
  try {
    if (context.state !== "running") throw new Error("Audio context is not running");
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    return { context, analyser };
  } catch {
    void context.close();
    return null;
  }
}

async function startMeter(
  stream: MediaStream,
  callbacks: { onLevel: (level: number) => void; onEndOfSpeech: () => void },
): Promise<Meter> {
  let ended = false;
  function endOfSpeech() {
    if (ended) return;
    ended = true;
    callbacks.onEndOfSpeech();
  }

  const audio = await connectAnalyser(stream);
  if (!audio) {
    // Without a meter, a time limit stops a recording that the user forgets.
    const timer = setTimeout(endOfSpeech, maxRecordingMs);
    return { active: false, peak: () => 0, stop: () => clearTimeout(timer) };
  }

  const { context, analyser } = audio;
  const samples = new Float32Array(analyser.fftSize);
  const startedAt = performance.now();
  let previous = startedAt;
  let lastSpeechAt = 0;
  let speechMs = 0;
  let peak = 0;
  let frame = 0;

  function tick(now: number) {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    peak = Math.max(peak, rms);
    if (rms > speechLevel) {
      speechMs += now - previous;
      lastSpeechAt = now;
    }
    previous = now;
    callbacks.onLevel(Math.min(1, rms * 8));

    const elapsed = now - startedAt;
    const spoke = speechMs >= minSpeechMs;
    if (spoke && now - lastSpeechAt > endOfSpeechMs) endOfSpeech();
    else if (!spoke && elapsed > noSpeechMs) endOfSpeech();
    else if (elapsed > maxRecordingMs) endOfSpeech();
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);

  return {
    active: true,
    peak: () => peak,
    stop: () => {
      cancelAnimationFrame(frame);
      callbacks.onLevel(0);
      void context.close();
    },
  };
}
