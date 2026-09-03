/** Magic-byte checks so a renamed .png cannot store HTML/JS. */

function head(buf, n) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.subarray(0, Math.min(n, b.length));
}

function ascii(buf, start, end) {
  return buf.toString("ascii", start, end);
}

export function sniffKind(buf) {
  if (!buf || buf.length < 4) return "unknown";
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 6) {
    const g = ascii(b, 0, 6);
    if (g === "GIF87a" || g === "GIF89a") return "gif";
  }
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "wav";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  if (ascii(b, 0, 4) === "fLaC") return "flac";
  if (ascii(b, 0, 4) === "%PDF") return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return "zip";
  if (ascii(b, 0, 3) === "ID3") return "mp3";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (brand === "qt  ") return "mov";
    if (brand === "M4A " || brand === "M4B ") return "m4a";
    return "mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";

  const sample = head(b, 512);
  if (!sample.includes(0)) {
    let odd = 0;
    for (const c of sample) {
      if (c < 9 || (c > 13 && c < 32) || c === 0x7f) odd += 1;
    }
    if (odd / sample.length < 0.02) return "txt";
  }
  return "unknown";
}

const EXT_KIND = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".gif": "gif",
  ".webp": "webp",
  ".mp4": "mp4",
  ".m4v": "mp4",
  ".mov": "mov",
  ".webm": "webm",
  ".ogv": "ogg",
  ".mp3": "mp3",
  ".ogg": "ogg",
  ".wav": "wav",
  ".m4a": "m4a",
  ".flac": "flac",
  ".txt": "txt",
  ".pdf": "pdf",
  ".zip": "zip",
};

const MP4_FAMILY = new Set(["mp4", "mov", "m4a"]);

export function attachmentAllowed(ext, buf) {
  const want = EXT_KIND[String(ext || "").toLowerCase()];
  if (!want) return false;
  const got = sniffKind(buf);
  if (MP4_FAMILY.has(want)) return MP4_FAMILY.has(got);
  if (want === "ogg") return got === "ogg";
  return got === want;
}
