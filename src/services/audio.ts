import path from 'path';
import fs from 'fs';
import OpenAI, { toFile } from 'openai';
import { extractAudioFromVideo } from '../utils/ffmpeg';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY required for video transcription');
    _openai = new OpenAI({ apiKey: key });
  }
  return _openai;
}

export async function extractAndAnalyzeAudio(videoPaths: string[]): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const summaries: string[] = [];

  for (const videoPath of videoPaths) {
    const audioPath = path.join(tempDir, path.basename(videoPath, path.extname(videoPath)) + '.mp3');
    try {
      await extractAudioFromVideo(videoPath, audioPath);
      if (!fs.existsSync(audioPath)) continue;

      if (process.env.OPENAI_API_KEY) {
        const buffer = fs.readFileSync(audioPath);
        const file = await toFile(buffer, 'audio.mp3');
        const transcription = await getOpenAI().audio.transcriptions.create({
          file,
          model: 'whisper-1',
        });
        if (transcription.text?.trim()) {
          summaries.push(`Video audio: ${transcription.text}`);
        }
      }
    } catch (err) {
      // Whisper may fail for short/silent clips - continue
    } finally {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }
  }

  if (summaries.length === 0) return 'No speech or notable audio detected in videos.';
  return summaries.join(' ');
}
