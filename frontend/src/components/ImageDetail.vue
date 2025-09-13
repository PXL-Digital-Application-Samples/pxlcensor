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
