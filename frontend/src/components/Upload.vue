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

    <div v-if="progress" class="progress">
      <div class="progress-bar" :style="{ width: progress + '%' }"></div>
      <span>{{ progressText }}</span>
    </div>

    <div v-if="error" class="error">
      {{ error }}
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
const fileInput = ref(null)

// Processing options with defaults
const processingOptions = ref({
  method: 'mosaic',
  mosaic_size: 20,
  scale_720p: false
})

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
  if (!file.value) return
  
  uploading.value = true
  error.value = null
  progress.value = 0
  
  try {
    // Step 1: Calculate SHA256
    progressText.value = 'Calculating file hash...'
    progress.value = 10
    const sha256 = await calculateSHA256(file.value)
    
    // Step 2: Initialize upload
    progressText.value = 'Initializing upload...'
    progress.value = 20
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
        // Image already processed, show success
        progressText.value = 'Image already processed!'
        progress.value = 100
        setTimeout(() => {
          emit('uploaded')
          reset()
        }, 2000)
        return
      } else {
        // Image exists but not yet processed
        progressText.value = 'Image already exists, processing...'
        progress.value = 50
      }
    } else {
      // Step 3: Upload file
      progressText.value = 'Uploading image...'
      progress.value = 30
      
      await axios.put(upload_url, file.value, {
        headers: {
          ...upload_headers,
          'Content-Type': 'application/octet-stream'
        },
        onUploadProgress: (e) => {
          if (e.lengthComputable) {
            progress.value = 30 + (e.loaded / e.total) * 40
          }
        }
      })
    }
    
    // Step 4: Trigger processing
    progressText.value = 'Starting face anonymization...'
    progress.value = 80
    
    const processResponse = await axios.post(`/api/images/${image_id}/process`, {
      pipeline: 'deface_boxes'
    })
    
    // Step 5: Complete
    progress.value = 100
    progressText.value = 'Upload complete! Processing in background...'
    
    // Just reset without redirecting
    setTimeout(() => {
      uploading.value = false
      progress.value = 0
      progressText.value = ''
      // Don't emit 'uploaded' to avoid automatic redirect
      // User can manually go to gallery when they want
    }, 3000)
    
  } catch (err) {
    // Reset progress and uploading state
    uploading.value = false
    progress.value = 0
    progressText.value = ''
    
    // Handle specific error cases
    if (err.response?.status === 409) {
      error.value = 'This image has already been processed. Try a different image or modify this one slightly to reprocess with new settings.'
    } else if (err.response?.data?.message) {
      error.value = err.response.data.message
    } else if (err.response?.data?.error) {
      error.value = err.response.data.error
    } else {
      error.value = err.message || 'Upload failed'
    }
  }
}

const reset = () => {
  file.value = null
  preview.value = null
  uploading.value = false
  progress.value = 0
  progressText.value = ''
  error.value = null
  
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

.error {
  margin-top: 1rem;
  padding: 1rem;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
}

.hint {
  display: block;
  color: #666;
  font-size: 0.85rem;
  margin-top: 0.25rem;
  font-style: italic;
}
</style>