import "server-only";

import {
  type AudioDetailV1,
  type AudioListItemV1,
  type AudioSearchResultV1,
  MAX_SAID_AT_QUERY_WORDS,
  type SimilarAudioV1,
} from "@/lib/api/v1/types";
import { findQueryInWords, transcriptWords } from "@/lib/audio/word-timings";
import type { AudioRecord, AudioSearchHit, DatasetRecord, SimilarAudioHit } from "@/server/audios/types";

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
    case "audiocaps": {
      // The AudioSet labels say what the clip is; the YouTube segment says where it's from.
      const labels = record.audioSetLabels.join(", ");
      const segment = `YouTube ${record.youtubeId} @ ${record.startTime}s`;
      return labels ? `${labels} · ${segment}` : segment;
    }
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

/** `dataset` is the record's own (`getDatasets()`): its split and original format. */
export function toAudioDetailV1(record: AudioRecord, dataset: DatasetRecord): AudioDetailV1 {
  const file = {
    fileName: record.fileName,
    sampleRate: record.sampleRate,
    channels: record.channels,
    split: dataset.split,
    originalFormat: dataset.originalFormat,
    lossyOrigin: dataset.lossyOrigin,
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
          wordTimings: record.wordTimings,
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
          audioSetLabels: record.audioSetLabels,
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
          wordTimings: record.wordTimings,
          ...file,
        },
      };
  }
}

/**
 * `query` and `exact` are the search's: where its words are said (`saidAt`) is
 * found like the Words search finds them (`exact`, as typed) or loosely
 * ("barks" also finds "barking").
 */
export function toAudioSearchResultV1(
  hit: AudioSearchHit,
  { query, exact }: { query: string; exact: boolean },
): AudioSearchResultV1 {
  const item = toAudioListItemV1(hit.record);
  const { wordTimings } = hit.record;
  const saidAt =
    wordTimings && hit.matches.includes("text") && transcriptWords(query).length <= MAX_SAID_AT_QUERY_WORDS
      ? findQueryInWords(wordTimings, query, { exact })
      : [];
  // Show the caption that explains the match, not always the first one.
  return { ...item, text: hit.caption ?? item.text, score: hit.score, matches: hit.matches, saidAt };
}

export function toSimilarAudioV1(hit: SimilarAudioHit): SimilarAudioV1 {
  return { ...toAudioListItemV1(hit.record), similarity: hit.similarity };
}
