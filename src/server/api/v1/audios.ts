import "server-only";

import type {
  AudioDetailV1,
  AudioListItemV1,
  AudioSearchResultV1,
  SimilarAudioV1,
} from "@/lib/api/v1/types";
import type { AudioRecord, AudioSearchHit, SimilarAudioHit } from "@/server/audios/types";

function titleOf(record: AudioRecord): string {
  if (record.source === "librispeech") {
    const book = record.chapter.bookTitle ?? `Chapter ${record.chapter.id}`;
    const reader = record.speaker.name ?? `speaker ${record.speaker.id}`;
    return `${book} · read by ${reader}`;
  }
  return `YouTube ${record.youtubeId} @ ${record.startTime}s`;
}

export function toAudioListItemV1(record: AudioRecord): AudioListItemV1 {
  return {
    id: record.id,
    source: record.source,
    title: titleOf(record),
    text: record.source === "librispeech" ? record.transcript : (record.captions[0] ?? ""),
    durationSeconds: record.durationSeconds,
  };
}

export function toAudioDetailV1(record: AudioRecord): AudioDetailV1 {
  const file = {
    fileName: record.fileName,
    sampleRate: record.sampleRate,
    channels: record.channels,
  };
  if (record.source === "librispeech") {
    return {
      ...toAudioListItemV1(record),
      source: "librispeech",
      metadata: {
        utteranceId: record.utteranceId,
        speaker: record.speaker,
        chapter: record.chapter,
        transcript: record.transcript,
        ...file,
      },
    };
  }
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", record.youtubeId);
  url.searchParams.set("t", `${record.startTime}s`);
  return {
    ...toAudioListItemV1(record),
    source: "audiocaps",
    metadata: {
      youtubeId: record.youtubeId,
      youtubeUrl: url.toString(),
      startTime: record.startTime,
      captions: record.captions,
      audiocapIds: record.audiocapIds,
      ...file,
    },
  };
}

export function toAudioSearchResultV1(hit: AudioSearchHit): AudioSearchResultV1 {
  const item = toAudioListItemV1(hit.record);
  // Show the caption that explains the match, not always the first one.
  return { ...item, text: hit.caption ?? item.text, score: hit.score, matches: hit.matches };
}

export function toSimilarAudioV1(hit: SimilarAudioHit): SimilarAudioV1 {
  return { ...toAudioListItemV1(hit.record), similarity: hit.similarity };
}
