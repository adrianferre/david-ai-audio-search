/**
 * Turns an audio file the browser can play (WAV, MP3, M4A/AAC, OGG, FLAC,
 * WebM…) into the clip the search API takes: 16 kHz mono 16-bit WAV, the
 * format the catalog itself was embedded from. That also keeps uploads small
 * (32 KB per second).
 */

const SAMPLE_RATE = 16_000;

/** Longer files are searched by their beginning. Catalog clips are 10–35 s. */
export const MAX_EXAMPLE_SECONDS = 30;

/** Cutting less than this off isn't worth telling the user about. */
const TRIM_TOLERANCE_SECONDS = 0.5;

export type ExampleClip = {
  wav: Blob;
  durationSeconds: number;
  /** The file was longer than `MAX_EXAMPLE_SECONDS` and was cut. */
  trimmed: boolean;
};

export class UnreadableAudioError extends Error {
  constructor() {
    super("Couldn't read this audio file. Try WAV, MP3 or M4A.");
    this.name = "UnreadableAudioError";
  }
}

export async function toExampleClip(file: Blob): Promise<ExampleClip> {
  const bytes = await file.arrayBuffer();

  let decoded: AudioBuffer;
  const context = new AudioContext();
  try {
    decoded = await context.decodeAudioData(bytes);
  } catch {
    throw new UnreadableAudioError();
  } finally {
    void context.close();
  }
  if (decoded.duration === 0) throw new UnreadableAudioError();

  const durationSeconds = Math.min(decoded.duration, MAX_EXAMPLE_SECONDS);
  // Rendering into a one-channel 16 kHz context downmixes and resamples.
  const offline = new OfflineAudioContext(1, Math.ceil(durationSeconds * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  return {
    wav: encodeWav(rendered.getChannelData(0), SAMPLE_RATE),
    durationSeconds,
    // Encoder framing and padding (Opus frames, AAC priming) make a recording
    // stopped at exactly MAX_EXAMPLE_SECONDS decode a few ms longer.
    trimmed: decoded.duration > MAX_EXAMPLE_SECONDS + TRIM_TOLERANCE_SECONDS,
  };
}

/** Mono float samples in [-1, 1] as a 16-bit PCM WAV file. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}
