// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const removeFileBtn = document.getElementById('removeFile');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultSection = document.getElementById('resultSection');
const reportPre = document.getElementById('reportPre');
const downloadLink = document.getElementById('downloadLink');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');

let selectedFile = null;

// --- File Selection Logic ---

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

// Drag and Drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    handleFileSelect(e.dataTransfer.files[0]);
  }
});

function handleFileSelect(file) {
  // Basic validation
  if (!file.type.startsWith('video/')) {
    alert('Please select a valid video file.');
    return;
  }

  selectedFile = file;
  
  // Update UI
  dropZone.style.display = 'none';
  fileInfo.style.display = 'flex';
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  
  // Hide previous results/errors
  resultSection.style.display = 'none';
  errorSection.style.display = 'none';
  progressContainer.style.display = 'block';
  updateProgress(0, 'Ready to upload...');
}

removeFileBtn.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = ''; // Reset input
  fileInfo.style.display = 'none';
  dropZone.style.display = 'block';
  progressContainer.style.display = 'none';
  resultSection.style.display = 'none';
  errorSection.style.display = 'none';
});

// --- Upload & Processing Logic ---

async function processVideo() {
  if (!selectedFile) return;

  const formData = new FormData();
  formData.append('video', selectedFile);

  // Show progress bar
  progressContainer.style.display = 'block';
  updateProgress(10, 'Uploading video...');

  try {
    // We use fetch with an XMLHttpRequest polyfill approach for progress tracking
    // Since fetch doesn't support upload progress natively in all browsers easily, 
    // we use XHR for the upload to get accurate progress events.
    
    const xhr = new XMLHttpRequest();
    
    xhr.open('POST', '/api/process');
    
    // Upload Progress
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = (event.loaded / event.total) * 50; // First 50% is upload
        const displayPercent = Math.min(percentComplete, 50);
        updateProgress(displayPercent, `Uploading... ${displayPercent.toFixed(0)}%`);
      }
    };

    // Response Handling
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const result = JSON.parse(xhr.responseText);
        handleSuccess(result);
      } else {
        const error = JSON.parse(xhr.responseText);
        handleError(error.error || 'Unknown error occurred');
      }
    };

    xhr.onerror = () => {
      handleError('Network error. Please check your connection.');
    };

    // Start processing
    // Simulate "Processing" phase after upload completes
    xhr.onreadystatechange = () => {
       if (xhr.readyState === 4 && xhr.status === 200) {
           // This is handled in onload, but we can add a small delay effect 
           // to make it feel like the server is working if it's fast
       }
    };

    // Before sending, show "Uploading"
    updateProgress(5, 'Starting upload...');
    
    // We need to simulate the "Processing" phase (50-100%) 
    // Since we don't know how long ffmpeg takes, we'll just show "Processing" 
    // once the upload is done and wait for the response.
    
    // Actually, the xhr.onload handles the final result. 
    // But we want the bar to go to 90% while waiting for ffmpeg.
    
    // Let's refine: 
    // 0-50%: Upload
    // 50-90%: Server Processing (Indeterminate or simulated)
    // 100%: Done
    
    // We'll handle the "Processing" state by listening to the upload end.
    xhr.upload.onload = () => {
       updateProgress(50, 'Upload complete. Processing video (this may take a while)...');
       // Start a fake progress indicator for the processing phase
       let fakeProgress = 50;
       const interval = setInterval(() => {
           if (fakeProgress < 90) {
               fakeProgress += Math.random() * 2;
               updateProgress(fakeProgress, 'Processing video...');
           }
       }, 1000);
       
       // Store interval to clear on completion
       window._processingInterval = interval;
    };

    xhr.send(formData);

  } catch (err) {
    handleError(err.message);
  }
}

function handleSuccess(data) {
  // Clear fake progress
  if (window._processingInterval) clearInterval(window._processingInterval);
  
  updateProgress(100, 'Success!');
  
  // Hide progress, show result
  progressContainer.style.display = 'none';
  resultSection.style.display = 'block';
  
  // Populate report
  reportPre.textContent = JSON.stringify(data.report, null, 2);
  
  // Set download link
  downloadLink.href = data.downloadUrl;
  downloadLink.textContent = `Download ${data.jobId.substring(0, 8)}.mp4`;
  
  // Scroll to result
  resultSection.scrollIntoView({ behavior: 'smooth' });
}

function handleError(message) {
  if (window._processingInterval) clearInterval(window._processingInterval);
  
  progressContainer.style.display = 'none';
  errorSection.style.display = 'block';
  errorMessage.textContent = message;
  
  // Reset file info to allow retry
  removeFileBtn.click(); 
}

// --- Utilities ---

function updateProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return +Math.round(Math.pow(10, dm) * bytes / Math.pow(k, i)) / Math.pow(10, dm) + ' ' + sizes[i];
}

// Auto-process if a file is dropped? 
// Or provide a button? The current UI has "Remove" but no "Start".
// Let's add a "Start Processing" button logic if the user hasn't clicked it yet.
// Wait, the HTML in the previous step didn't have a "Start" button, it just had the drop zone.
// Let's assume the user wants to process immediately upon selection or add a button.
// For better UX, let's add a "Process Video" button dynamically or assume 
// the user expects it to start automatically.
// I will add a "Process" button to the HTML in the previous step's mental model, 
// but since I can't edit the HTML now without re-posting, I will make it 
// auto-process on file selection for simplicity, OR I will add a listener 
// to a button if it exists.
// Actually, looking at the HTML provided earlier:
// <button id="browseBtn">Browse Files</button>
// There is no "Start" button.
// I will modify the JS to auto-start processing when a file is selected.

// Update handleFileSelect to auto-process
const originalHandleFileSelect = handleFileSelect;
handleFileSelect = function(file) {
   originalHandleFileSelect(file);
   processVideo();
}
