<template>
  <div class="gallery">
    <div class="gallery-header">
      <h2>Processed Images</h2>
      <div class="filters">
        <select v-model="filter" @change="loadImages">
          <option value="">All Images</option>
          <option value="done">Completed</option>
          <option value="processing">Processing</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
        </select>
        <button class="btn" @click="loadImages">Refresh</button>
      </div>
    </div>

    <div v-if="loading" class="loading">Loading images...</div>
    
    <div v-else-if="images.length === 0" class="empty">
      <p>No images found. Upload some images to get started!</p>
    </div>

    <div v-else class="image-grid">
      <div 
        v-for="image in images" 
        :key="image.id"
        class="image-card"
        @click="$emit('select', image.id)"
      >
        <div class="image-container">
          <img 
            v-if="image.processed_url" 
            :src="image.processed_url"
            :alt="`Processed ${image.id}`"
          />
          <div v-else class="placeholder">
            <span v-if="image.status === 'processing'">🔄 Processing...</span>
            <span v-else-if="image.status === 'queued'">⏳ Queued</span>
            <span v-else-if="image.status === 'failed'">❌ Failed</span>
            <span v-else>📸 Uploaded</span>
          </div>
          
          <!-- DELETE BUTTON -->
          <button 
            class="delete-btn" 
            @click.stop="deleteImage(image.id)"
            title="Delete this image"
          >
            ✕
          </button>
        </div>
        <div class="image-info">
          <span class="status-badge" :class="`status-${image.status}`">
            {{ image.status }}
          </span>
          <span class="date">{{ formatDate(image.created_at) }}</span>
        </div>
      </div>
    </div>

    <div v-if="!loading && images.length > 0" class="pagination">
      <button 
        class="btn btn-secondary" 
        @click="prevPage" 
        :disabled="page === 1"
      >
        Previous
      </button>
      <span>Page {{ page }}</span>
      <button 
        class="btn btn-secondary" 
        @click="nextPage"
        :disabled="images.length < pageSize"
      >
        Next
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const emit = defineEmits(['select'])

const images = ref([])
const loading = ref(false)
const filter = ref('')
const page = ref(1)
const pageSize = 12

const loadImages = async () => {
  loading.value = true
  try {
    const params = {
      page: page.value,
      pageSize
    }
    if (filter.value) {
      params.status = filter.value
    }
    
    const response = await axios.get('/api/images', { params })
    images.value = response.data.images
  } catch (err) {
    console.error('Failed to load images:', err)
  } finally {
    loading.value = false
  }
}

const prevPage = () => {
  if (page.value > 1) {
    page.value--
    loadImages()
  }
}

const nextPage = () => {
  page.value++
  loadImages()
}

const formatDate = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
}

const deleteImage = async (imageId) => {
  if (!confirm('Are you sure you want to delete this image? This will remove all files and cannot be undone.')) {
    return
  }
  
  try {
    await axios.delete(`/api/images/${imageId}`)
    // Remove from local array immediately for better UX
    images.value = images.value.filter(img => img.id !== imageId)
  } catch (err) {
    console.error('Failed to delete image:', err)
    alert('Failed to delete image. Please try again.')
  }
}

onMounted(() => {
  loadImages()
  // Auto-refresh every 5 seconds
  setInterval(loadImages, 5000)
})
</script>

<style scoped>
.gallery {
  padding: 2rem 0;
}

.gallery-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.filters {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.filters select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
}

.loading, .empty {
  text-align: center;
  padding: 4rem;
  background: white;
  border-radius: 8px;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.5rem;
}

.image-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.3s, box-shadow 0.3s;
}

.image-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.image-container {
  width: 100%;
  height: 200px;
  background: #f0f0f0;
  position: relative;
}

.image-container img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #e74c3c;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.delete-btn:hover {
  background: #e74c3c;
  color: white;
  transform: scale(1.1);
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 1.2rem;
  color: #666;
}

.image-info {
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.date {
  font-size: 0.75rem;
  color: #666;
}

.pagination {
  margin-top: 2rem;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
}
</style>