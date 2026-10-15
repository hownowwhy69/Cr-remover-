const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { transformVideo } = require('./lib/transformer');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directories exist
const dataDirs = ['uploads', 'outputs', 'logs'];
dataDirs.forEach(dir => {
  if (!fs.existsSync(`data/${dir}`)) fs.mkdirSync(`data/${dir}`, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'data/uploads/'),
  filename: (req, file, cb) => cb(null, `upload_${uuidv4()}_${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB limit
  fileFilter: (req, file, cb) => {
    const allowed = /mp4|mov|mkv|avi|webm/;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowed.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error('Unsupported file format'));
  }
});

app.use(express.json());
app.use(express.static('public'));
app.use('/outputs', express.static('data/outputs'));

// Main API Endpoint
app.post('/api/process', upload.single('video'), async (req, res) => {
  const jobId = uuidv4();
  const inputPath = req.file.path;
  const outputPath = path.join('data/outputs', `${jobId}.mp4`);
  
  try {
    console.log(`Job ${jobId} started for ${req.file.originalname}`);
    
    // Execute the transformation pipeline
    const report = await transformVideo({ inputPath, outputPath, jobId });
    
    console.log(`Job ${jobId} completed successfully`);
    
    res.json({
      success: true,
      jobId,
      downloadUrl: `/outputs/${path.basename(outputPath)}`,
      report
    });

  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => console.log(`CR Remover running at http://localhost:${PORT}`));
