/* Model input preprocessing — the ONE copy.
 *
 * This lives in its own file because it had two copies: the app's
 * identify path and the admin Test Image panel. They drifted. The app
 * letterboxed; the admin still ran the original
 * drawImage(img, 0, 0, size, size), which squashes a 3:4 photo into a
 * square. Body proportions are a primary ID cue, so the admin panel was
 * handing the model a distorted fish and reporting the result as the
 * model's accuracy — worst on the long, thin species (barracuda,
 * vermilion snapper) where the squash changes the animal's shape most.
 *
 * Both paths import this. They cannot drift again.
 */

/* region (optional): { x, y, w, h } in 0..1 of the source image, so a
   caller can classify a sub-crop without re-encoding the photo.

   Aspect is PRESERVED (letterboxed), not squashed. This used to be
   drawImage(img, 0, 0, size, size), which stretched a 3:4 portrait into
   a square — body proportions are a primary ID cue, so the model was
   being handed a distorted fish. */
export function imageToRgb(img, size, region) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Neutral grey padding — black would read as a dark object.
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const sx = region ? Math.max(0, Math.round(region.x * iw)) : 0;
  const sy = region ? Math.max(0, Math.round(region.y * ih)) : 0;
  const sw = region ? Math.max(1, Math.round(region.w * iw)) : iw;
  const sh = region ? Math.max(1, Math.round(region.h * ih)) : ih;

  const scale = Math.min(size / sw, size / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh,
    Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
  const rgba = ctx.getImageData(0, 0, size, size).data;
  const pixelCount = size * size;
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    rgb[i * 3]     = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}
