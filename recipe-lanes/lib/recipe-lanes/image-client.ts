/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Client-side photo preparation for the photo-to-recipe flow (issue #182).
 *
 * Phone cameras produce 4–12MB images (often HEIC on iPhone), which
 * base64-inflate past the server-action transport limit and fail with an
 * opaque "error in the server components render" — our size check never even
 * runs. So we downscale + re-encode in the browser: text stays perfectly
 * legible for the vision model at ~1600px, the payload drops to a few hundred
 * KB, and decoding via canvas normalizes any browser-displayable format
 * (HEIC/TIFF/etc.) to JPEG.
 */

/** Longest-edge target. 1600px keeps cookbook text crisp for OCR-style parsing. */
export const MAX_PHOTO_EDGE_PX = 1600;
/** JPEG quality for the re-encode. */
export const PHOTO_JPEG_QUALITY = 0.85;

/**
 * Reads an image File, downscales it so its longest edge is at most
 * `maxEdge`, and returns a JPEG data URL. Uses createImageBitmap when
 * available (applies EXIF orientation), falling back to an <img> decode.
 * Throws if the browser cannot decode the file at all.
 */
export async function fileToRecipePhotoDataUrl(
  file: File,
  maxEdge: number = MAX_PHOTO_EDGE_PX,
  quality: number = PHOTO_JPEG_QUALITY,
): Promise<string> {
  const { width, height, draw, cleanup } = await decodeImage(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process that image (canvas unavailable).');
    // White background: JPEG has no alpha, and transparent PNGs would
    // otherwise composite onto black and hide dark text.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    draw(ctx, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    cleanup();
  }
}

type DecodedImage = {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  // Preferred path: createImageBitmap honours EXIF orientation, so photos
  // taken in portrait aren't handed to the model sideways.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path (e.g. Safari HEIC quirks).
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read that image. Please try a JPEG or PNG photo.'));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}
