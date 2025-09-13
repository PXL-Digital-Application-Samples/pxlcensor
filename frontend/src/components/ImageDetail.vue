<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Image Details</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      
      <div v-if="loading" class="loading">Loading...</div>
      
      <div v-else-if="image" class="modal-content">
        <div class="image-comparison">
          <div class="image-panel">
            <h3>Original</h3>
            <img 
              v-if="originalUrl" 
              :src="originalUrl"
              alt="Original"
              @error="originalError = true"
            />
            <div v-else class="placeholder">
              <span v-if="originalError">Failed to load</span>
              <span v-else>Loading original...</span>
            </div>
          </div>
          
          <div class="image-panel">
            <h3>Processed</h3>
            <img 
              v-if="image.processed_url" 
              :src="image.processed_url"
              alt="Processed"
            />
            <div v-else class="placeholder">
              <span v-if="image.status === 'processing'">🔄 Processing...</span>
              <span v-else-if="image.status === 'queued'">⏳ In Queue</span>
              <span v-else-if="image.status === 'failed'">❌ Processing Failed</span>
              <span v-else>Not processed yet</span>
            </div>
          </div>
        </div>
        
        <div class="details">
          <h3>Information</h3>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="label">Status:</span>
              <span class="status-badge" :class="`status-${image.status}`">
                {{ image.status }}
              </span>
            </div>
            <div class="detail-item">
              <span class="label">Type:</span>
              <span>{{ image.mime }}</span>
            </div>
            <div class="detail-item">
              <span class="label">Size:</span>
              <span>{{ formatBytes(image.bytes) }}</span>
            </div>
            <div class="detail-item">
              <span class="label">Uploaded:</span>
              <span>{{ formatDate(image.created_at) }}</span>
            </div>
          </div>
        </div>
        
        <div v-if="image.events && image.events.length > 0" class="events">
          <h3>Processing Timeline</h3>
          <div class="timeline">
            <div v-for="event in image.events" :key="event.at" class="timeline-item">
              <div class="timeline-marker"></div>
              <div class="timeline-content">
                <div class="timeline-type">{{ formatEventType(event.type) }}</div>
                <div class="timeline-time">{{ formatDate(event.at) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import axios from 'axios'

const props = defineProps({
  imageId: String
})

const emit = defineEmits(['close'])

const image = ref(null)
const loading = ref(true)
const originalUrl = ref('')
const originalError = ref(false)

const loadImage = async () => {
  if (!props.imageId) return
  
  try {
    loading.value = true
    const response = await axios.get(`/api/images/${props.imageId}`)
    image.value = response.data
    
    if (response.data.original_url) {
      originalUrl.value = response.data.original_url
    }
  } catch (error) {
    console.error('Failed to load image:', error)
  } finally {
    loading.value = false
  }
}

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString()
}

const formatEventType = (type) => {
  const types = {
    'uploaded': 'Uploaded',
    'queued': 'Queued for Processing',
    'job_completed': 'Processing Completed'
  }
  return types[type] || type
}

onMounted(loadImage)
watch(() => props.imageId, loadImage)
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 8px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  margin: 20px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #eee;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
}

.modal-content {
  padding: 20px;
}

.image-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 30px;
}

.image-panel h3 {
  margin-bottom: 10px;
  text-align: center;
}

.image-panel img {
  width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.placeholder {
  width: 100%;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 4px;
  color: #666;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.label {
  font-weight: 600;
  color: #666;
  font-size: 14px;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  width: fit-content;
}

.status-uploaded { background: #e3f2fd; color: #1976d2; }
.status-queued { background: #fff3e0; color: #f57c00; }
.status-processing { background: #fff3e0; color: #f57c00; }
.status-done { background: #e8f5e8; color: #388e3c; }
.status-failed { background: #ffebee; color: #d32f2f; }

.timeline {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: 15px;
}

.timeline-marker {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #2196f3;
  flex-shrink: 0;
}

.timeline-content {
  flex: 1;
}

.timeline-type {
  font-weight: 600;
  margin-bottom: 2px;
}

.timeline-time {
  font-size: 14px;
  color: #666;
}

.loading {
  padding: 40px;
  text-align: center;
  color: #666;
}

@media (max-width: 768px) {
  .image-comparison {
    grid-template-columns: 1fr;
  }
  
  .modal {
    margin: 10px;
  }
}
</style>
