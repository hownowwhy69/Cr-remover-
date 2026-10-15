// lib/report.js
const fs = require('fs');

async function writeReport(filePath, data) {
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function readReport(filePath) {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

module.exports = { writeReport, readReport };
