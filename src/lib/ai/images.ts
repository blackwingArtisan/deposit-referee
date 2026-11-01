import type Anthropic from "@anthropic-ai/sdk";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** An image for Claude: base64 data, a data: URL (from a browser upload), or a public URL. */
export type ImageInput = { base64: string; mediaType: ImageMediaType } | { dataUrl: string } | { url: string };

/** The API rejects images over 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES: ImageMediaType[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function parseDataUrl(dataUrl: string): { base64: string; mediaType: ImageMediaType } {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw new Error("Expected a base64 data URL like data:image/png;base64,...");
  const mediaType = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : (m[1].toLowerCase() as ImageMediaType);
  if (!MEDIA_TYPES.includes(mediaType)) throw new Error(`Unsupported image type ${m[1]}; use PNG, JPEG, GIF or WebP.`);
  return { base64: m[2], mediaType };
}

export function imageBlock(image: ImageInput): Anthropic.Beta.BetaImageBlockParam {
  if ("url" in image) return { type: "image", source: { type: "url", url: image.url } };
  const { base64, mediaType } = "dataUrl" in image ? parseDataUrl(image.dataUrl) : image;
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) throw new Error(`Image is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB. Resize it before upload.`);
  return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
}
