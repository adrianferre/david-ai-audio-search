import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/** The same cap as a file the user attaches; the browser decodes the whole of it. */
export const MAX_REMOTE_AUDIO_BYTES = 20 * 1024 * 1024;

const MAX_REDIRECTS = 5;
/** The whole download, redirects included. */
const TIMEOUT_MS = 30_000;

/** Why a link couldn't be fetched, worded for the user. */
export class RemoteAudioError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RemoteAudioError";
  }
}

/*
 * The server fetches what the user links to, so a link must not reach
 * anything only the server can: loopback, private networks, link-local (cloud
 * metadata at 169.254.169.254) and other reserved ranges. Addresses are
 * checked as the socket connects (see `publicOnlyLookup`), so a DNS answer
 * can't change between the check and the connection.
 */
// One list per family: a BlockList also matches IPv4 addresses against
// IPv6 rules for their mapped form (::ffff:0:0/96), which would block them all.
const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // IPv4-mapped and NAT64 addresses lead to IPv4 hosts the IPv4 list can't vouch for.
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !blockedV4.check(address, "ipv4");
    case 6:
      return !blockedV6.check(address, "ipv6");
    default:
      return false;
  }
}

const notPublic = () =>
  new RemoteAudioError(400, "invalid_url", "The link must point to a public website.");

/** Resolves like the default lookup, but fails if any address isn't public. */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) {
      return callback(notPublic(), "", 0);
    }
    if (options.all) {
      // The callback's types only describe the single-address form.
      (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
};

/** An http(s) URL to a public host, or the error to tell the user. */
export function parseRemoteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new RemoteAudioError(400, "invalid_url", "That isn’t a valid link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteAudioError(400, "invalid_url", "The link must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new RemoteAudioError(400, "invalid_url", "Links with a user name or password aren’t supported.");
  }
  // An IP literal never goes through the lookup; check it here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && !isPublicAddress(host)) throw notPublic();
  return url;
}

function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(url, {
      lookup: publicOnlyLookup,
      signal,
      headers: { accept: "audio/*, video/*;q=0.9, */*;q=0.5", "user-agent": "AudioSearch/1.0" },
    });
    request.once("response", resolve);
    request.once("error", reject);
  });
}

/** Content types that can't be an audio or video file. */
function isPageOrText(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType.startsWith("image/") ||
    contentType.includes("html") ||
    contentType.includes("json") ||
    contentType.includes("xml")
  );
}

/**
 * Downloads the audio or video file a link points to, following redirects,
 * for the browser to decode as it does a file the user attaches. Only public
 * hosts, at most `MAX_REMOTE_AUDIO_BYTES`, within `TIMEOUT_MS`.
 */
export async function fetchRemoteAudio(
  input: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  let url = parseRemoteUrl(input);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);

  try {
    for (let redirects = 0; ; redirects++) {
      const response = await get(url, combined);
      const status = response.statusCode ?? 0;

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects === MAX_REDIRECTS) {
          throw new RemoteAudioError(502, "remote_fetch_failed", "The link redirects too many times.");
        }
        url = parseRemoteUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (status !== 200) {
        response.resume();
        throw new RemoteAudioError(
          502,
          "remote_fetch_failed",
          status === 401 || status === 403
            ? "The site didn’t allow downloading the file. Use a public link."
            : status === 404
              ? "Nothing was found at that link."
              : status === 429
                ? "The site is limiting downloads right now. Try again later."
              : `The site answered with an error (${status}).`,
        );
      }

      const contentType = (response.headers["content-type"] ?? "application/octet-stream")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (isPageOrText(contentType)) {
        response.resume();
        throw new RemoteAudioError(
          415,
          "not_audio",
          "That link opens a web page, not an audio file. Use a direct link to the file, like one ending in .mp3, .wav or .m4a.",
        );
      }
      const tooBig = () =>
        new RemoteAudioError(413, "payload_too_large", "The file at that link is over 20 MB.");
      if (Number(response.headers["content-length"]) > MAX_REMOTE_AUDIO_BYTES) {
        response.destroy();
        throw tooBig();
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > MAX_REMOTE_AUDIO_BYTES) {
          response.destroy();
          throw tooBig();
        }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return { bytes, contentType };
    }
  } catch (error) {
    if (error instanceof RemoteAudioError) throw error;
    if (timeout.aborted) {
      throw new RemoteAudioError(504, "remote_timeout", "The file took too long to download.");
    }
    if (signal.aborted) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new RemoteAudioError(502, "remote_fetch_failed", "Couldn’t find that website.");
    }
    throw new RemoteAudioError(502, "remote_fetch_failed", "Couldn’t download the file at that link.");
  }
}
