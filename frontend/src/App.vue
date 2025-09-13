<template>
  <div id="app">
    <nav class="navbar">
      <div class="nav-brand">
        <h1>🔲 pxlcensor</h1>
      </div>
      <div class="nav-links">
        <button @click="currentView = 'upload'" :class="{ active: currentView === 'upload' }">Upload</button>
        <button @click="currentView = 'gallery'" :class="{ active: currentView === 'gallery' }">Gallery</button>
        <button @click="currentView = 'queue'" :class="{ active: currentView === 'queue' }">Queue</button>
      </div>
    </nav>

    <main class="container">
      <Upload v-if="currentView === 'upload'" @uploaded="handleUploaded" />
      <Gallery v-if="currentView === 'gallery'" @select="handleImageSelect" />
      <Queue v-if="currentView === 'queue'" />
      <ImageDetail v-if="selectedImage" :imageId="selectedImage" @close="selectedImage = null" />
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Upload from './components/Upload.vue'
import Gallery from './components/Gallery.vue'
import Queue from './components/Queue.vue'
import ImageDetail from './components/ImageDetail.vue'

const currentView = ref('upload')
const selectedImage = ref(null)

const handleUploaded = () => {
  currentView.value = 'gallery'
}

const handleImageSelect = (imageId) => {
  selectedImage.value = imageId
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background: #f5f5f5;
  color: #333;
}

#app {
  min-height: 100vh;
}

.navbar {
  background: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nav-brand h1 {
  font-size: 1.5rem;
  color: #333;
}

.nav-links {
  display: flex;
  gap: 1rem;
}

.nav-links button {
  background: none;
  border: none;
  padding: 0.5rem 1rem;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.3s;
}

.nav-links button:hover {
  background: #f0f0f0;
}

.nav-links button.active {
  background: #333;
  color: white;
}

.container {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.btn {
  background: #333;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  transition: background 0.3s;
}

.btn:hover {
  background: #555;
}

.btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.btn-secondary {
  background: #666;
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
}

.status-uploaded { background: #e3f2fd; color: #1976d2; }
.status-queued { background: #fff3e0; color: #f57c00; }
.status-processing { background: #f3e5f5; color: #7b1fa2; }
.status-done { background: #e8f5e9; color: #388e3c; }
.status-failed { background: #ffebee; color: #c62828; }
</style>
