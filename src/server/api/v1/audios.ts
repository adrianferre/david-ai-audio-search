import "server-only";

import type {
  AudioDetailV1,
  AudioListItemV1,
  AudioSearchResultV1,
  SimilarAudioV1,
} from "@/lib/api/v1/types";
import type { AudioRecord, AudioSearchHit, SimilarAudioHit } from "@/server/audios/types";

/** Common Voice stores gender as e.g. `female_feminine`; show the first word. */
function genderLabel(gender: string | null): string | null {
  return gender ? gender.split("_")[0].replaceAll("-", " ") : null;
}

function titleOf(record: AudioRecord): string {
  switch (record.source) {
    case "librispeech": {
      const book = record.chapter.bookTitle ?? `Chapter ${record.chapter.id}`;
      const reader = record.speaker.name ?? `speaker ${record.speaker.id}`;
      return `${book} · read by ${reader}`;
    }
    case "audiocaps":
      return `YouTube ${record.youtubeId} @ ${record.startTime}s`;
    case "commonvoice": {
      const { clientId, age, gender, accent } = record.speaker;
      const about = [genderLabel(gender), age, accent].filter(Boolean).join(", ");
      const speaker = `Speaker ${clientId.slice(0, 8)}`;
      return about ? `${speaker} · ${about}` : speaker;
    }
  }
}

export function toAudioListItemV1(record: AudioRecord): AudioListItemV1 {
  return {
    id: record.id,
    source: record.source,
    title: titleOf(record),
    text: record.source === "audiocaps" ? (record.captions[0] ?? "") : record.transcript,
    durationSeconds: record.durationSeconds,
    waveformPeaks: record.waveformPeaks,
  };
}

export function toAudioDetailV1(record: AudioRecord): AudioDetailV1 {
  const file = {
    fileName: record.fileName,
    sampleRate: record.sampleRate,
    channels: record.channels,
  };
  switch (record.source) {
    case "librispeech":
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
    case "audiocaps": {
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
    case "commonvoice":
      return {
        ...toAudioListItemV1(record),
        source: "commonvoice",
        metadata: {
          clipId: record.clipId,
          sentenceId: record.sentenceId,
          speaker: record.speaker,
          transcript: record.transcript,
          upVotes: record.upVotes,
          downVotes: record.downVotes,
          locale: record.locale,
          ...file,
        },
      };
  }
}

export function toAudioSearchResultV1(hit: AudioSearchHit): AudioSearchResultV1 {
  const item = toAudioListItemV1(hit.record);
  // Show the caption that explains the match, not always the first one.
  return { ...item, text: hit.caption ?? item.text, score: hit.score, matches: hit.matches };
}

export function toSimilarAudioV1(hit: SimilarAudioHit): SimilarAudioV1 {
  return { ...toAudioListItemV1(hit.record), similarity: hit.similarity };
}
