import ffmpeg from 'fluent-ffmpeg';

export function extractAudioFromVideo(videoPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioQuality(2)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`FFmpeg failed: ${err.message}. Install: brew install ffmpeg`)))
      .save(outputPath);
  });
}
