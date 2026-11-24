"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { audioFileUrl } from "@/lib/api/v1/client";

export type PlayerStatus = "loading" | "playing" | "paused" | "error";

export type PlayerState =
  | { id: null }
  | { id: string; status: PlayerStatus; currentTime: number };

/**
 * One shared <audio> element for the whole list, so only one audio plays at a
 * time and playback survives its row being virtualized away.
 */
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const idRef = useRef<string | null>(null);
  // While a new source is starting, the old one's "pause" event is noise.
  const startingRef = useRef(false);
  const [state, setState] = useState<PlayerState>({ id: null });

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const update = (status: PlayerStatus) =>
      setState((s) => (s.id ? { ...s, status, currentTime: audio.currentTime } : s));

    const handlers: Record<string, () => void> = {
      playing: () => {
        startingRef.current = false;
        update("playing");
      },
      waiting: () => update("loading"),
      pause: () => {
        if (!startingRef.current && !audio.ended) update("paused");
      },
      timeupdate: () =>
        setState((s) => (s.id ? { ...s, currentTime: audio.currentTime } : s)),
      ended: () => {
        idRef.current = null;
        setState({ id: null });
      },
      error: () => {
        startingRef.current = false;
        update("error");
      },
    };
    for (const [event, handler] of Object.entries(handlers)) {
      audio.addEventListener(event, handler);
    }
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        audio.removeEventListener(event, handler);
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, []);

  /** Play `id`, or pause/resume it if it's already the current audio. */
  const toggle = useCallback((id: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    const isCurrent = idRef.current === id && !audio.error;
    if (isCurrent && !audio.paused) {
      // Pausing before the first "playing" (still loading) is a real pause.
      startingRef.current = false;
      audio.pause();
      return;
    }
    if (!isCurrent) {
      idRef.current = id;
      startingRef.current = true;
      audio.src = audioFileUrl(id);
      setState({ id, status: "loading", currentTime: 0 });
    }
    audio.play().catch((error: unknown) => {
      // AbortError: another audio was picked before this one started.
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (idRef.current !== id) return;
      startingRef.current = false;
      setState((s) => (s.id === id ? { ...s, status: "error" } : s));
    });
  }, []);

  return { state, toggle };
}
