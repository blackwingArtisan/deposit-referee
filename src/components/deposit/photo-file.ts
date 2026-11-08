/**
 * Reads a photo the host or renter picked, in the browser, and refuses it with a plain message if it
 * is too big, not a photo, or can't be drawn. The server checks again before anything reaches the AI.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export const NOT_A_PHOTO = "That file isn't a readable photo. Choose a JPEG, PNG or WebP photo.";

export async function photoDataUrl(file: File): Promise<string> {
  if (file.type && !TYPES.includes(file.type)) throw new Error(NOT_A_PHOTO);
  if (file.size > MAX_BYTES) throw new Error("That photo is over 5 MB. Choose a smaller one.");
  if (typeof createImageBitmap === "function") {
    try {
      (await createImageBitmap(file)).close();
    } catch {
      throw new Error(NOT_A_PHOTO);
    }
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}
