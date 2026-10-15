// lib/pipeline.js
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const crypto = require('crypto');

// Utility: deterministic pseudo-random from seed
function seededRandom(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  let state = parseInt(hash.substring(0, 8), 16);
  return function() {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// Get probe info
async function probe(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// Transform video
async function transformVideo(params) {
  const { inputPath, outputPath, jobId } = params;
  const seed = params.seed || crypto.createHash('sha256').update(inputPath).digest('hex');
  const rand = seededRandom(seed);

  // Default params
  const speed = params.speed ?? (0.98 + rand() * 0.06); // 0.98–1.04
  const pitch = params.pitch ?? (rand() < 0.5 ? 0 : (rand() < 0.5 ? 1 : -1)); // -1, 0, +1 semitone
  const brightness = params.brightness ?? (rand() * 0.06 - 0.03); // -3% to +3%
  const contrast = params.contrast ?? (rand() * 0.06 - 0.03);
  const saturation = params.saturation ?? (rand() * 0.06 - 0.03);
  const scale = params.scale ?? (0.995 + rand() * 0.01); // 99.5%–100.5%
  const bitrate = params.bitrate ?? 2500; // kbps
  const watermark = params.watermark || '';

  const probeData = await probe(inputPath);
  const videoStream = probeData.streams.find(s => s.codec_type === 'video');
  const audioStream = probeData.streams.find(s => s.codec_type === 'audio');

  const hasAudio = !!audioStream;
  const duration = probeData.format.duration || 0;

  // Build ffmpeg command
  const cmd = ffmpeg(inputPath);

  // Video filters
  const videoFilters = [];
  if (scale !== 1) {
    videoFilters.push(`scale=iw*${scale}:ih*${scale}:flags=lanczos`);
  }
  if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
    videoFilters.push(
      `eq=brightness=${brightness}:contrast=${1 + contrast}:saturation=${1 + saturation}`
    );
  }
  if (watermark) {
    // Burn in a small watermark at bottom right
    videoFilters.push(
      `drawtext=text='${watermark}':fontcolor=white@0.7:x=w-tw-10:y=h-th-10:fontsize=16`
    );
  }
  if (videoFilters.length) {
    cmd.videoFilters(videoFilters);
  }

  // Audio filters
  const audioFilters = [];
  if (pitch !== 0 && hasAudio) {
    // Use asetrate + atempo to pitch shift (approximate)
    // For 1 semitone, ratio = 2^(1/12)
    const ratio = Math.pow(2, pitch / 12);
    // asetrate changes sample rate; we'll compensate with atempo
    audioFilters.push(`asetrate=44100*${ratio.toFixed(6)}`);
    audioFilters.push(`atempo=${(1 / ratio).toFixed(6)}`);
  }
  if (hasAudio && audioFilters.length) {
    cmd.audioFilters(audioFilters);
  }

  // Speed change (video + audio)
  if (speed !== 1) {
    // Use setpts for video, atempo for audio
    const videoSpeedFilter = `setpts=PTS/${speed.toFixed(6)}`;
    cmd.videoFilters([...(cmd._videoFilters || []), videoSpeedFilter]);
    if (hasAudio) {
      const audioSpeedFilter = `atempo=${speed.toFixed(6)}`;
      cmd.audioFilters([...(cmd._audioFilters || []), audioSpeedFilter]);
    }
  }

  // Output settings
  cmd
    .on('end', () => resolve(outputPath))
    .on('error', (err) => reject(err))
    .outputOptions([
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-b:v', `${bitrate}k`,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-movflags', '+faststart',
      '-map_metadata', '-1' // Strip metadata
    ])
    .output(outputPath);

  return new Promise((resolve, reject) => {
    cmd.on('end', () => {
      const report = {
        jobId,
        input: {
          path: inputPath,
          duration,
          hasAudio,
          videoCodec: videoStream?.codec_name,
          audioCodec: audioStream?.codec_name
        },
        output: {
          path: outputPath,
          codec: 'h264',
          bitrate,
          sampleRate: 44100
        },
        transformations: {
          speed,
          pitch,
          brightness,
          contrast,
          saturation,
          scale,
          watermark
        },
        seed,
        timestamp: new Date().toISOString()
      };
      resolve(report);
    });
    cmd.on('error', reject);
    cmd.run();
  });
}

module.exports = { transformVideo };
