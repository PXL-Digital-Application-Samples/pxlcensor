<template>
  <div class="upload-container">
    <div 
      class="dropzone" 
      :class="{ 'dragging': isDragging }"
      @drop="handleDrop"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
    >
      <input 
        type="file" 
        ref="fileInput" 
        @change="handleFileSelect"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        style="display: none"
      />
      
      <div v-if="!file" class="dropzone-content" @click="$refs.fileInput.click()">
        <div class="upload-icon">📸</div>
        <h2>Drop image here or click to browse</h2>
        <p>Supports JPG, PNG, WebP up to 25MB</p>
      </div>

      <div v-else class="preview-container">
        <img :src="preview" alt="Preview" />
        <div class="file-info">
          <h3>{{ file.name }}</h3>
          <p>{{ formatBytes(file.size) }}</p>
        </div>
      </div>
    </div>

    <!-- UNIFIED STATUS BOX - ONE BOX FOR EVERYTHING -->
    <div v-if="status" class="unified-status" :class="status">
      <div class="status-content">
        <div class="status-message">{{ statusMessage }}</div>
        <div v-if="progress && status !== 'success' && status !== 'error'" class="progress-container">
          <div class="progress-bar" :style="{ width: progress + '%' }"></div>
          <span class="progress-text">{{ progressText }}</span>
        </div>
        <div v-if="error && status === 'error'" class="error-message">{{ error }}</div>
      </div>
    </div>

    <div v-if="file" class="processing-options">
      <h3>Processing Options</h3>
      
      <div class="option-group">
        <label for="method">Anonymization Method:</label>
        <select id="method" v-model="processingOptions.method">
          <option value="mosaic">Mosaic (Default)</option>
          <option value="blur">Blur</option>
          <option value="solid">Solid Black Box</option>
        </select>
      </div>

      <div v-if="processingOptions.method === 'mosaic'" class="option-group">
        <label for="mosaicSize">Mosaic Size:</label>
        <input 
          type="range" 
          id="mosaicSize" 
          v-model.number="processingOptions.mosaic_size" 
          min="5" 
          max="120" 
          step="5"
        />
        <span>{{ processingOptions.mosaic_size }}px</span>
        <small class="hint">Auto-calculated based on image size</small>
      </div>

      <div class="option-group">
        <label>
          <input 
            type="checkbox" 
            v-model="processingOptions.scale_720p"
          />
          Scale to 720p (reduces file size, faster processing)
        </label>
      </div>
    </div>

    <div v-if="file" class="actions">
      <button class="btn btn-secondary" @click="reset">Change Image</button>
      <button class="btn" @click="upload" :disabled="uploading">
        {{ uploading ? 'Uploading...' : 'Upload & Process' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import axios from 'axios'

const emit = defineEmits(['uploaded'])

const isDragging = ref(false)
const file = ref(null)
const preview = ref(null)
const uploading = ref(false)
const progress = ref(0)
const progressText = ref('')
const error = ref(null)
const status = ref(null)
const statusMessage = ref('')
const fileInput = ref(null)

// Processing options with defaults - BULLETPROOF INITIALIZATION
const processingOptions = ref({
  method: 'mosaic',
  mosaic_size: 20,
  scale_720p: false
})

// Ensure processingOptions is always properly initialized
const ensureProcessingOptions = () => {
  if (!processingOptions.value || typeof processingOptions.value !== 'object') {
    processingOptions.value = {
      method: 'mosaic',
      mosaic_size: 20,
      scale_720p: false
    }
  }
}

// Calculate smart mosaic size based on image dimensions and file size
const calculateSmartMosaicSize = async (file) => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // Calculate actual megapixels from image dimensions
      const megapixels = (img.width * img.height) / (1024 * 1024)
      
      let mosaicSize
      if (megapixels < 1) {
        mosaicSize = 15  // Small images (<1MP) - 15px
      } else if (megapixels < 4) {
        mosaicSize = 25  // Medium images (1-4MP) - 25px  
      } else if (megapixels < 8) {
        mosaicSize = 40  // Large images (4-8MP) - 40px
      } else if (megapixels < 16) {
        mosaicSize = 60  // Very large images (8-16MP) - 60px
      } else if (megapixels < 32) {
        mosaicSize = 80  // Ultra high-res images (16-32MP) - 80px
      } else {
        mosaicSize = 100 // Extremely high-res images (>32MP) - 100px
      }
      
      resolve(mosaicSize)
    }
    img.onerror = () => {
      // Fallback to file size estimation if image loading fails
      const estimatedMegapixels = file.size / (300 * 1024)
      if (estimatedMegapixels < 1) resolve(15)
      else if (estimatedMegapixels < 4) resolve(25) 
      else if (estimatedMegapixels < 8) resolve(40)
      else if (estimatedMegapixels < 16) resolve(60)
      else if (estimatedMegapixels < 32) resolve(80)
      else resolve(100)
    }
    img.src = URL.createObjectURL(file)
  })
}

const handleDrop = (e) => {
  e.preventDefault()
  isDragging.value = false
  
  const files = e.dataTransfer.files
  if (files.length > 0) {
    selectFile(files[0])
  }
}

const handleFileSelect = (e) => {
  const files = e.target.files
  if (files.length > 0) {
    selectFile(files[0])
  }
}

const selectFile = async (selectedFile) => {
  // Validate file type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!validTypes.includes(selectedFile.type)) {
    error.value = 'Invalid file type. Please select a JPG, PNG, or WebP image.'
    return
  }

  // Validate file size (25MB)
  if (selectedFile.size > 25 * 1024 * 1024) {
    error.value = 'File too large. Maximum size is 25MB.'
    return
  }

  error.value = null
  file.value = selectedFile
  
  // Calculate smart mosaic size based on actual image dimensions
  const smartMosaicSize = await calculateSmartMosaicSize(selectedFile)
  
  // BULLETPROOF: Ensure processing options exist before setting
  ensureProcessingOptions()
  processingOptions.value.mosaic_size = smartMosaicSize
  
  // Create preview
  const reader = new FileReader()
  reader.onload = (e) => {
    preview.value = e.target.result
  }
  reader.readAsDataURL(selectedFile)
}

const calculateSHA256 = async (file) => {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

const upload = async () => {
  if (!file.value) {
    setStatus('error', 'No file selected')
    return
  }
  
  // BULLETPROOF: Ensure processing options exist
  ensureProcessingOptions()
  
  uploading.value = true
  setStatus('uploading', 'Starting upload...')
  progress.value = 0
  
  try {
    // Step 1: Calculate SHA256
    setStatus('uploading', 'Calculating file hash...', 10)
    const sha256 = await calculateSHA256(file.value)
    
    // Step 2: Initialize upload
    setStatus('uploading', 'Initializing upload...', 20)
    const initResponse = await axios.post('/api/upload-init', {
      filename: file.value.name,
      mime: file.value.type,
      bytes: file.value.size,
      sha256: sha256,
      processing_options: processingOptions.value
    })
    
    const { image_id, upload_url, upload_headers, duplicate, status, processed_path } = initResponse.data
    
    if (duplicate) {
      if (status === 'complete' && processed_path) {
        // Image already processed
        setStatus('success', 'Image already processed!', 100)
        setTimeout(() => {
          reset()
        }, 2000)
        return
      } else {
        // Image exists but not yet processed
        setStatus('uploading', 'Image already exists, processing...', 50)
      }
    } else {
      // Step 3: Upload file
      setStatus('uploading', 'Uploading image...', 30)
      
      await axios.put(upload_url, file.value, {
        headers: {
          ...upload_headers,
          'Content-Type': 'application/octet-stream'
        },
        onUploadProgress: (e) => {
          if (e.lengthComputable) {
            const uploadProgress = 30 + (e.loaded / e.total) * 40
            setStatus('uploading', 'Uploading image...', uploadProgress)
          }
        }
      })
    }
    
    // Step 4: Trigger processing
    setStatus('uploading', 'Starting face anonymization...', 80)
    
    console.log('About to trigger processing for image:', image_id)
    const processResponse = await axios.post(`/api/images/${image_id}/process`, {
      pipeline: 'deface_boxes'
    })
    console.log('Processing triggered successfully:', processResponse.data)
    
    // Step 5: Complete - SUCCESSFUL UPLOAD!
    setStatus('success', 'Succeeded!', 100)
    
    // Show success for 3 seconds, then reset
    setTimeout(() => {
      reset()
    }, 3000)
    
  } catch (err) {
    console.error('Upload failed:', err)
    console.error('Error response:', err.response)
    
    // Handle specific error cases with appropriate messages
    let errorMessage = 'Upload failed'
    let errorDetails = null
    
    if (err.response?.status === 409) {
      errorMessage = 'Already Processed'
    } else if (err.response?.data?.message) {
      errorMessage = 'Upload Failed'
      errorDetails = err.response.data.message
    } else if (err.response?.data?.error) {
      errorMessage = 'Upload Failed'
      errorDetails = err.response.data.error
    } else {
      errorMessage = 'Upload Failed'
      errorDetails = err.message || 'Unknown error'
    }
    
    setStatus('error', errorMessage, 100, errorDetails)
    
    // Show error for 3 seconds, then reset
    setTimeout(() => {
      reset()
    }, 3000)
  }
  
  uploading.value = false
}

// Helper function to set unified status
const setStatus = (type, message, progressValue = null, errorDetails = null) => {
  status.value = type
  statusMessage.value = message
  if (progressValue !== null) {
    progress.value = progressValue
  }
  if (type === 'uploading' && progressValue) {
    progressText.value = `${Math.round(progressValue)}%`
  } else {
    progressText.value = ''
  }
  error.value = errorDetails
}

const reset = () => {
  file.value = null
  preview.value = null
  uploading.value = false
  progress.value = 0
  progressText.value = ''
  error.value = null
  status.value = null
  statusMessage.value = ''
  
  // Reset processing options to defaults
  processingOptions.value = {
    method: 'mosaic',
    mosaic_size: 20,
    scale_720p: false
  }
  
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}
</script>

<style scoped>
.upload-container {
  max-width: 600px;
  margin: 0 auto;
}

.dropzone {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 3rem;
  text-align: center;
  transition: all 0.3s;
  background: white;
}

.dropzone.dragging {
  border-color: #333;
  background: #f9f9f9;
}

.dropzone-content {
  cursor: pointer;
}

.upload-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.preview-container {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.preview-container img {
  width: 200px;
  height: 200px;
  object-fit: cover;
  border-radius: 8px;
}

.file-info {
  text-align: left;
}

.processing-options {
  margin: 2rem 0;
  padding: 1.5rem;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.processing-options h3 {
  margin: 0 0 1rem 0;
  color: #333;
  font-size: 1.1rem;
}

.option-group {
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.option-group label {
  font-weight: 500;
  color: #555;
  min-width: 140px;
}

.option-group select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  min-width: 180px;
}

.option-group input[type="range"] {
  flex: 1;
  margin: 0 0.5rem;
}

.option-group input[type="checkbox"] {
  margin-right: 0.5rem;
}

.option-group span {
  min-width: 50px;
  font-weight: 500;
  color: #333;
}

.actions {
  margin-top: 2rem;
  display: flex;
  gap: 1rem;
  justify-content: center;
}

.progress {
  margin-top: 2rem;
  background: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  height: 40px;
}

.progress-bar {
  background: #333;
  height: 100%;
  transition: width 0.3s;
}

.progress span {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #333;
  font-weight: 500;
}

.progress-bar.success {
  background: linear-gradient(90deg, #4caf50, #66bb6a);
}

.progress-bar.error {
  background: linear-gradient(90deg, #f44336, #ef5350);
}

.error {
  margin-top: 1rem;
  padding: 1rem;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
}

/* UNIFIED STATUS BOX - ONE BOX FOR ALL STATUS */
.unified-status {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  min-width: 400px;
  max-width: 500px;
  padding: 1.5rem;
  border-radius: 12px;
  font-weight: 600;
  text-align: center;
  box-shadow: 0 6px 20px rgba(0,0,0,0.2);
  backdrop-filter: blur(10px);
}

.unified-status.uploading {
  background: linear-gradient(135deg, #f8f9fa, #e9ecef);
  color: #495057;
  border: 2px solid #6c757d;
}

.unified-status.success {
  background: linear-gradient(135deg, #d4edda, #c3e6cb);
  color: #155724;
  border: 2px solid #28a745;
}

.unified-status.error {
  background: linear-gradient(135deg, #f8d7da, #f5c6cb);
  color: #721c24;
  border: 2px solid #dc3545;
}

.status-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.status-message {
  font-size: 1.2rem;
  font-weight: 700;
}

.progress-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.progress-bar {
  background: #28a745;
  height: 8px;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.9rem;
  opacity: 0.8;
}

.error-message {
  background: rgba(255,255,255,0.7);
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.95rem;
  color: #721c24;
  border: 1px solid rgba(220,53,69,0.3);
}

.hint {
  display: block;
  color: #666;
  font-size: 0.85rem;
  margin-top: 0.25rem;
  font-style: italic;
}
</style>