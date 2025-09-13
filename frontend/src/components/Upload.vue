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

const selectFile = (selectedFile) => {
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
      sha256: sha256
    })
    
    const { image_id, upload_url, upload_headers, duplicate } = initResponse.data
    
    if (duplicate) {
      progressText.value = 'Image already exists, processing...'
      progress.value = 50
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
    
    await axios.post(`/api/images/${image_id}/process`, {
      pipeline: 'deface_boxes'
    })
    
    // Step 5: Complete
    progress.value = 100
    progressText.value = 'Upload complete! Processing in background...'
    
    setTimeout(() => {
      emit('uploaded')
      reset()
    }, 2000)
    
  } catch (err) {
    error.value = err.response?.data?.error || err.message || 'Upload failed'
    uploading.value = false
  }
}

const reset = () => {
  file.value = null
  preview.value = null
  uploading.value = false
  progress.value = 0
  progressText.value = ''
  error.value = null
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
</style>