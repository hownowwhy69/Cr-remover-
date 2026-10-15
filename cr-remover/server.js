// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { transformVideo } = require('./lib/pipeline');
const { writeReport, readReport } = require('./lib/report');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const OUTPUTS_DIR = path.join(DATA_DIR, 'outputs');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

// Ensure dirs exist
for (const dir of [DATA_DIR, UPLOADS_DIR, OUTPUTS_DIR, REPORTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `upload_${uuidv4()}_${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (req, file, cb) => {
    const okTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
    if (okTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  }
});

// Middleware
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload + transform
app.post('/api/transform', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const inputPath = req.file.path;
    const jobId = uuidv4();
    const outputPath = path.join(OUTPUTS_DIR, `${jobId}.mp4`);
    const reportPath = path.join(REPORTS_DIR, `${jobId}.json`);

    const params = {
      inputPath,
      outputPath,
      reportPath,
      jobId,
      // Optional overrides
      speed: req.body.speed ? parseFloat(req.body.speed) : undefined,
      pitch: req.body.pitch ? parseInt(req.body.pitch, 10) : undefined,
      brightness: req.body.brightness ? parseFloat(req.body.brightness) : undefined,
      contrast: req.body.contrast ? parseFloat(req.body.contrast) : undefined,
      saturation: req.body.saturation ? parseFloat(req.body.saturation) : undefined,
      scale: req.body.scale ? parseFloat(req.body.scale) : undefined,
      bitrate: req.body.bitrate ? parseInt(req.body.bitrate, 10) : undefined,
      watermark: req.body.watermark || undefined,
      seed: req.body.seed || undefined
    };

    const report = await transformVideo(params);
    await writeReport(reportPath, report);

    return res.json({
      jobId,
      downloadUrl: `/outputs/${path.basename(outputPath)}`,
      report
    });
  } catch (err) {
    console.error('Transform error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Serve outputs
app.use('/outputs', express.static(OUTPUTS_DIR));

// Get report
app.get('/api/report/:jobId', (req, res) => {
  const reportPath = path.join(REPORTS_DIR, `${req.params.jobId}.json`);
  readReport(reportPath)
    .then(report => res.json(report))
    .catch(() => res.status(404).json({ error: 'Report not found' }));
});

app.listen(PORT, () => {
  console.log(`CR Remover running at http://localhost:${PORT}`);
});
