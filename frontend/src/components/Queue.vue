<template>
  <div class="queue">
    <h2>Processing Queue</h2>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{{ stats.queued || 0 }}</div>
        <div class="stat-label">Queued</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.processing || 0 }}</div>
        <div class="stat-label">Processing</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.done || 0 }}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.failed || 0 }}</div>
        <div class="stat-label">Failed</div>
      </div>
    </div>

    <div class="metrics">
      <h3>System Metrics</h3>
      <div class="metrics-grid">
        <div class="metric">
          <span class="metric-label">Total Images:</span>
          <span class="metric-value">{{ metrics.total_images || 0 }}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Processed:</span>
          <span class="metric-value">{{ metrics.processed_images || 0 }}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Recent Failures:</span>
          <span class="metric-value">{{ metrics.recent_failures || 0 }}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Queue Depth:</span>
          <span class="metric-value">{{ metrics.queued_jobs || 0 }}</span>
        </div>
      </div>
    </div>

    <div class="refresh-info">
      Auto-refreshing every 2 seconds
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const stats = ref({})
const metrics = ref({})
let refreshInterval = null

const loadQueueStats = async () => {
  try {
    const [queueResponse, metricsResponse] = await Promise.all([
      axios.get('/api/queue'),
      axios.get('/api/metrics')
    ])
    
    // Convert stats array to object
    const statsObj = {}
    queueResponse.data.stats.forEach(item => {
      statsObj[item.status] = item.count
    })
    stats.value = statsObj
    
    metrics.value = metricsResponse.data
  } catch (err) {
    console.error('Failed to load queue stats:', err)
  }
}

onMounted(() => {
  loadQueueStats()
  refreshInterval = setInterval(loadQueueStats, 2000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})
</script>

<style scoped>
.queue {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin: 2rem 0;
}

.stat-card {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  text-align: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.stat-value {
  font-size: 2.5rem;
  font-weight: bold;
  color: #333;
}

.stat-label {
  font-size: 0.875rem;
  color: #666;
  text-transform: uppercase;
  margin-top: 0.5rem;
}

.metrics {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  margin-top: 2rem;
}

.metrics h3 {
  margin-bottom: 1rem;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.metric {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #f0f0f0;
}

.metric-label {
  color: #666;
}

.metric-value {
  font-weight: 600;
  color: #333;
}

.refresh-info {
  text-align: center;
  color: #666;
  font-size: 0.875rem;
  margin-top: 2rem;
}
</style>
