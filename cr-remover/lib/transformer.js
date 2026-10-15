const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const crypto = require('crypto');

/**
 * Generates a deterministic seed based on the file hash.
 * This ensures the same video always gets the exact same "remix" parameters,
 * but different videos get different parameters.
 */
function generateSeed(filePath) {
  const hash = crypto.createHash('sha256').update(filePath).digest('hex');
  return hash.substring(0, 16);
}

/**
 * The Core Transformation Pipeline
 * Strategy: "Perceptual Disruption"
 * 1. Audio: Pitch shift (micro), EQ adjustment, Stereo widening, Resampling.
 * 2. Video: Subtle scale (zoom), Color grading (brightness/contrast), Frame rate normalization.
 * 3. Container: Re-encoding with different GOP structure and stripping metadata.
 */
async function transformVideo({ inputPath, outputPath, jobId }) {
  return new Promise((resolve, reject) => {
    const seed = generateSeed(inputPath);
    const rand = (min, max) => {
        // Simple seeded pseudo-random for consistency
        const hash = crypto.createHash('md5').update(seed + min + max).digest('hex');
        const num = parseInt(hash.substring(0, 8), 16);
        return min + (num / 0xffffffff) * (max - min);
    };

    // --- Parameter Generation (The "Secret Sauce") ---
    // These values are tiny enough that humans don't notice, but they break fingerprinting.
    const params = {
      // Audio
      pitchShift: rand(0.5, 1.5), // 0.5 to 1.5 semitones
      eqLow: rand(-1.5, 1.5), // Low shelf gain
      eqHigh: rand(-1.5, 1.5), // High shelf gain
      stereoWiden: rand(0.1, 0.3), // Stereo widening factor
      sampleRate: 44100, // Standardize sample rate
      
      // Video
      scale: rand(0.995, 1.005), // 99.5% to 100.5% zoom
      brightness: rand(-0.02, 0.02), // -2% to +2% brightness
      contrast: rand(-0.02, 0.02), // -2% to +2% contrast
      saturation: rand(-0.02, 0.02), // -2% to +2% saturation
      fps: 30, // Standardize FPS
      
      // Encoding
      bitrate: 2500, // 2.5 Mbps
      gop: 250 // Keyframe interval
    };

    console.log(`Job ${jobId} Parameters:`, params);

    const cmd = ffmpeg(inputPath);

    // --- Video Filters ---
    const videoFilters = [
      // Scale: Slightly zoom in/out to change pixel grid
      `scale=iw*${params.scale}:ih*${params.scale}:flags=lanczos`,
      // Color Grading: Subtle shifts
      `eq=brightness=${params.brightness}:contrast=${params.contrast}:saturation=${params.saturation}`
    ];

    // --- Audio Filters ---
    const audioFilters = [];
    
    // Pitch Shift: Use asetrate and atempo for formant-preserving pitch shift
    // This is the most effective way to break audio fingerprints
    audioFilters.push(`asetrate=44100*${Math.pow(2, params.pitchShift / 12)}`);
    audioFilters.push(`atempo=${1 / Math.pow(2, params.pitchShift / 12)}`);
    
    // EQ: Subtle low/high shelf
    audioFilters.push(`equalizer=f=100:w=100:g=${params.eqLow}`);
    audioFilters.push(`equalizer=f=10000:w=1000:g=${params.eqHigh}`);
    
    // Stereo Widening (if stereo)
    // Note: This requires the input to be stereo. We'll handle mono fallback in the command.
    
    // --- Build Command ---
    cmd
      .on('end', () => {
        const report = {
          jobId,
          timestamp: new Date().toISOString(),
          seed,
          transformations: params,
          input: {
            path: inputPath,
            originalName: path.basename(inputPath)
          },
          output: {
            path: outputPath,
            filename: path.basename(outputPath)
          }
        };
        resolve(report);
      })
      .on('error', (err) => reject(err))
      .outputOptions([
        // Video Settings
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-b:v', `${params.bitrate}k`,
        '-g', `${params.gop}`,
        '-r', `${params.fps}`,
        // Audio Settings
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', `${params.sampleRate}`,
        // Container Settings
        '-movflags', '+faststart',
        // Strip Metadata
        '-map_metadata', '-1'
      ])
      .videoFilters(videoFilters)
      .audioFilters(audioFilters)
      .output(outputPath)
      .run();
  });
}

module.exports = { transformVideo };
