import fs from 'fs';
import { chatWithImages, isLlmConfigured } from './llmClient';

export async function analyzePhotos(filePaths: string[]): Promise<string[]> {
  if (!isLlmConfigured()) {
    return filePaths.map(() => 'No API key - using placeholder');
  }
  if (filePaths.length === 0) return [];

  const images: { mimeType: string; data: string }[] = [];
  for (const filePath of filePaths) {
    const imageBuffer = fs.readFileSync(filePath);
    const base64 = imageBuffer.toString('base64');
    const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
    const mime = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
    images.push({ mimeType: mime, data: base64 });
  }

  const text = `Describe each of these ${filePaths.length} image(s) in 1-2 sentences each: the scene, mood, lighting, colors, and any activities or landscape. Focus on the emotional/vibe quality. Return a JSON array of strings, one per image, in order. Example: ["description1", "description2"]`;

  const raw = await chatWithImages(images, text, { responseMimeType: 'application/json' });
  if (!raw) return filePaths.map(() => 'Unknown scene');

  try {
    const parsed = JSON.parse(raw) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return filePaths.map((_, i) => (typeof arr[i] === 'string' ? arr[i] : 'Unknown scene'));
  } catch {
    return filePaths.map(() => raw || 'Unknown scene');
  }
}
