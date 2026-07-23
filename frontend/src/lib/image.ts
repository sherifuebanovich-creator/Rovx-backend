// Avatars are stored inline in the DB as data URIs (Render's free-tier disk
// is ephemeral, so file uploads don't survive deploys). To keep those rows
// and every API response that includes an avatar small, images are downscaled
// client-side before upload: max 512px on the long side, JPEG ~85%.
export async function downscaleImage(file: File, maxDim = 512, quality = 0.85): Promise<File> {
  // GIFs would lose animation through canvas; small ones pass through as-is.
  if (file.type === 'image/gif' && file.size < 300 * 1024) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}
