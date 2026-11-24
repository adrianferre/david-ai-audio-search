"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Records from the microphone with `MediaRecorder`. The result is whatever the
 * browser records (WebM/Opus in Chrome and Firefox, MP4/AAC in Safari), which
 * `toExampleClip` decodes like any uploaded file.
 */

export type RecorderStatus = "idle" | "starting" | "recording";

/**
 * Taps the microphone while it records, to draw its loudness. Read it with
 * `getFloatTimeDomainData` in an animation frame: it doesn't trigger renders.
 */
export type LevelMeter = { analyser: AnalyserNode; startedAt: number };

/** Shorter recordings are almost surely a mis-click. */
const MIN_SECONDS = 1;

export class RecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingError";
  }
}

function startError(error: unknown): RecordingError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new RecordingError(
      "Microphone access is blocked. Allow it in your browser's site settings to record.",
    );
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new RecordingError("No microphone found.");
  }
  if (name === "NotReadableError") {
    return new RecordingError("The microphone is in use by another app.");
  }
  return new RecordingError("Couldn't start the microphone.");
}

export function useMicrophoneRecorder({
  maxSeconds,
  onRecorded,
  onError,
}: {
  /** Recording stops by itself after this long. */
  maxSeconds: number;
  onRecorded: (recording: Blob, durationSeconds: number) => void;
  onError: (error: RecordingError) => void;
}) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [meter, setMeter] = useState<LevelMeter | null>(null);

  // Bumped by every start and cancel: late results of an old attempt are dropped.
  const attempt = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimers = useRef<() => void>(() => {});

  // Keep the latest callbacks without restarting anything.
  const callbacks = useRef({ onRecorded, onError });
  useEffect(() => {
    callbacks.current = { onRecorded, onError };
  });

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    attempt.current++;
    stop();
    stopTimers.current();
    recorderRef.current = null;
    setStatus("idle");
    setElapsedSeconds(0);
    setMeter(null);
  }, [stop]);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      callbacks.current.onError(new RecordingError("This browser can't record audio."));
      return;
    }
    const current = ++attempt.current;
    setStatus("starting");
    setElapsedSeconds(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Call-style processing is tuned for voices: noise suppression would
        // filter out the very sounds (a dog, an engine…) the user wants to find.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (error) {
      if (current !== attempt.current) return;
      setStatus("idle");
      callbacks.current.onError(startError(error));
      return;
    }
    let audioContext: AudioContext | null = null;
    const releaseMicrophone = () => {
      stream.getTracks().forEach((track) => track.stop());
      void audioContext?.close().catch(() => {});
    };
    if (current !== attempt.current) {
      releaseMicrophone();
      return;
    }

    // Only for drawing the levels: recording works without it.
    let analyser: AnalyserNode | null = null;
    try {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      // Safari may create it suspended, since the click was before the permission prompt.
      void audioContext.resume().catch(() => {});
    } catch {
      void audioContext?.close().catch(() => {});
      audioContext = null;
      analyser = null;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      releaseMicrophone();
      setStatus("idle");
      callbacks.current.onError(new RecordingError("This browser can't record audio."));
      return;
    }
    const chunks: Blob[] = [];
    let startedAt = 0;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMicrophone();
      stopTimers.current();
      if (current !== attempt.current) return;
      const durationSeconds = Math.min((performance.now() - startedAt) / 1000, maxSeconds);
      recorderRef.current = null;
      setStatus("idle");
      setElapsedSeconds(0);
      setMeter(null);
      if (durationSeconds < MIN_SECONDS || chunks.length === 0) {
        callbacks.current.onError(new RecordingError("That was too short. Record at least a second."));
        return;
      }
      callbacks.current.onRecorded(
        new Blob(chunks, { type: recorder.mimeType || chunks[0].type }),
        durationSeconds,
      );
    };
    recorder.onerror = () => {
      attempt.current++;
      releaseMicrophone();
      stopTimers.current();
      recorderRef.current = null;
      setStatus("idle");
      setElapsedSeconds(0);
      setMeter(null);
      callbacks.current.onError(new RecordingError("The recording failed. Try again."));
    };
    // The microphone was unplugged or the permission revoked: keep what we have.
    stream.getAudioTracks().forEach((track) => track.addEventListener("ended", stop));

    recorderRef.current = recorder;
    recorder.start();
    startedAt = performance.now();
    setStatus("recording");
    setMeter(analyser ? { analyser, startedAt } : null);

    const tick = setInterval(() => setElapsedSeconds((performance.now() - startedAt) / 1000), 250);
    const limit = setTimeout(stop, maxSeconds * 1000);
    stopTimers.current = () => {
      clearInterval(tick);
      clearTimeout(limit);
    };
  }, [maxSeconds, stop]);

  // Leaving the page section turns the microphone off.
  useEffect(() => cancel, [cancel]);

  return { status, elapsedSeconds, meter, start, stop, cancel };
}
