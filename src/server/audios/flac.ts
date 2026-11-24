import "server-only";

import { open } from "node:fs/promises";

export type FlacInfo = {
  sampleRate: number;
  channels: number;
  totalSamples: number;
  durationSeconds: number;
};

/**
 * Reads the FLAC STREAMINFO block (always the first metadata block) from the
 * first 42 bytes of the file. Layout: "fLaC" (4) + block header (4) + STREAMINFO (34).
 */
export async function readFlacInfo(filePath: string): Promise<FlacInfo> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(42);
    const { bytesRead } = await handle.read(buf, 0, 42, 0);
    if (bytesRead < 42 || buf.toString("ascii", 0, 4) !== "fLaC") {
      throw new Error(`Not a FLAC file: ${filePath}`);
    }
    // STREAMINFO starts at byte 8. Bytes 10..17 of it pack:
    // sample rate (20 bits) | channels-1 (3) | bits-1 (5) | total samples (36)
    const s = 8 + 10;
    const sampleRate = (buf[s] << 12) | (buf[s + 1] << 4) | (buf[s + 2] >> 4);
    const channels = ((buf[s + 2] >> 1) & 0b111) + 1;
    const totalSamples =
      (buf[s + 3] & 0x0f) * 2 ** 32 + buf.readUInt32BE(s + 4);
    const durationSeconds =
      sampleRate > 0 ? Math.round((totalSamples / sampleRate) * 1000) / 1000 : 0;
    return { sampleRate, channels, totalSamples, durationSeconds };
  } finally {
    await handle.close();
  }
}
