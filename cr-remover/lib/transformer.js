const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

/**
 * Generates a deterministic seed based on the file path.
 * This ensures the same video always gets the exact same "remix" parameters,
 * but different videos get different parameters.
 */
function generateSeed(filePath) {
  const hash = crypto.createHash('sha256').update(filePath).digest('hex');
  return hash.substring(0, 16);
}

/**
 * Seeded Pseudo-Random Number Generator
 * @param {string} seed - The seed string
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} A number between min and max
 */
function seededRandom(seed, min, max) {
  const hash = crypto.createHash('md5').update(seed + min + max).digest('hex');
  const num = parseInt(hash.substring(0, 8), 16);
  return min + (num / 0xffffffff) * (max - min);
}

/**
 * Probes the video to get metadata (duration, streams, etc.)
 * @param {string} filePath - Path to the video file
 * @returns {Promise<object>} - ffprobe data
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * The Core Transformation Pipeline
 * Strategy: "Perceptual Disruption"
 * 
 * 1. Audio: 
 *    - Pitch Shift (Formant Preserving): Changes the fundamental frequency without changing tempo.
 *    - EQ: Subtle low/high shelf adjustments.
 *    - Stereo Processing: Widening or Upmixing.
 * 2. Video: 
 *    - Scale: Subtle zoom (99.5% - 100.5%) to change pixel grid alignment.
 *    - Color Grading: Subtle brightness/contrast/saturation shifts.
 * 3. Container: 
 *    - Re-encoding with libx264.
 *    - Stripping all metadata.
 *    - Faststart for web streaming.
 */
async function transformVideo({ inputPath, outputPath, jobId }) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Generate Seed
      const seed = generateSeed(inputPath);
      
      // 2. Probe Video
      const probeData = await probeVideo(inputPath);
      const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
      const videoStream = probeData.streams.find(s => s.codec_type === 'video');
      
      const hasAudio = !!audioStream;
      const isStereo = hasAudio && audioStream.channels > 1;
      const duration = probeData.format.duration || 0;

      // 3. Generate Transformation Parameters
      // These values are tiny enough that humans don't notice, but they break fingerprinting.
      const params = {
        // Audio
        pitchShift: seededRandom(seed, 0.5, 1.5), // 0.5 to 1.5 semitones
        eqLow: seededRandom(seed, -1.5, 1.5), // Low shelf gain (dB)
        eqHigh: seededRandom(seed, -1.5, 1.5), // High shelf gain (dB)
        stereoWiden: seededRandom(seed, 0.1, 0.3), // Stereo widening factor
        sampleRate: 44100, // Standardize sample rate
        
        // Video
        scale: seededRandom(seed, 0.995, 1.005), // 99.5% to 100.5% zoom
        brightness: seededRandom(seed, -0.02, 0.02), // -2% to +2% brightness
        contrast: seededRandom(seed, -0.02, 0.02), // -2% to +2% contrast
        saturation: seededRandom(seed, -0.02, 0.02), // -2% to +2% saturation
        fps: 30, // Standardize FPS
        
        // Encoding
        bitrate: 2500, // 2.5 Mbps
        gop: 250 // Keyframe interval
      };

      console.log(`Job ${jobId} Parameters:`, params);

      // 4. Build Filter Chains
      const videoFilters = [];
      const audioFilters = [];

      // --- Video Filters ---
      // Scale: Slightly zoom in/out to change pixel grid
      videoFilters.push(`scale=iw*${params.scale}:ih*${params.scale}:flags=lanczos`);
      
      // Color Grading: Subtle shifts
      videoFilters.push(`eq=brightness=${params.brightness}:contrast=${params.contrast}:saturation=${params.saturation}`);

      // --- Audio Filters ---
      if (hasAudio) {
        // Pitch Shift: Formant-Preserving
        // 1. asetrate: Changes the sample rate, which changes pitch and tempo.
        // 2. atempo: Reverses the tempo change, leaving only the pitch shift.
        // 3. aresample: Ensures the output sample rate is standard.
        
        const pitchRatio = Math.pow(2, params.pitchShift / 12);
        
        // asetrate changes the sample rate. We multiply the original sample rate by the ratio.
        // If original is 44100 and ratio is 1.06 (1 semitone), new rate is ~46746.
        audioFilters.push(`asetrate=${44100 * pitchRatio}`);
        
        // atempo reverses the tempo. If speed increased by 1.06x, we slow it down by 1/1.06x.
        audioFilters.push(`atempo=${1 / pitchRatio}`);
        
        // EQ: Subtle low/high shelf
        audioFilters.push(`equalizer=f=100:w=100:g=${params.eqLow}`);
        audioFilters.push(`equalizer=f=10000:w=1000:g=${params.eqHigh}`);

        // Stereo Processing
        if (isStereo) {
          // Stereo Widening: Enhances the stereo image
          audioFilters.push(`stereotools=mlev=${params.stereoWiden}:revel=${params.stereoWiden}`);
        } else {
          // Mono to Stereo Upmix: Ensures consistent output channel count
          audioFilters.push(`pan=stereo|c0=c0|c1=c0`);
        }
      }

      // 5. Build FFmpeg Command
      const cmd = ffmpeg(inputPath);

      // Apply Filters
      if (videoFilters.length) {
        cmd.videoFilters(videoFilters);
      }
      if (audioFilters.length) {
        cmd.audioFilters(audioFilters);
      }

      // Output Options
      cmd.outputOptions([
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
      ]);

      // 6. Execute
      cmd.on('end', () => {
        const report = {
          jobId,
          timestamp: new Date().toISOString(),
          seed,
          transformations: params,
          input: {
            path: inputPath,
            originalName: path.basename(inputPath),
            duration
          },
          output: {
            path: outputPath,
            filename: path.basename(outputPath)
          },
          audio: {
            hasAudio,
            isStereo
          }
        };
        
        console.log(`Job ${jobId} completed successfully.`);
        resolve(report);
      });

      cmd.on('error', (err) => {
        console.error(`Job ${jobId} failed:`, err.message);
        reject(err);
      });

      cmd.output(outputPath).run();

    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { transformVideo };
