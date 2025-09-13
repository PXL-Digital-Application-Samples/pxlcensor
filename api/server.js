import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { createHash, randomUUID } from 'crypto';
import pg from 'pg';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info'
  },
  bodyLimit: parseInt(process.env.MAX_UPLOAD_MB || '25') * 1024 * 1024
});

// Config
const config = {
  port: process.env.PORT || 8080,
  host: '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://pxlcensor:devpassword@localhost:5432/pxlcensor',
  mediaServiceUrl: process.env.MEDIA_SERVICE_URL || 'http://localhost:8081',
  mediaExternalUrl: process.env.MEDIA_EXTERNAL_URL || process.env.MEDIA_SERVICE_URL || 'http://localhost:8081',
  mediaSigningSecret: process.env.MEDIA_SIGNING_SECRET || 'dev-secret-change-in-production',
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_MB || '25') * 1024 * 1024
};

// Database connection
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Register plugins
await app.register(cors, {
  origin: true,
  credentials: true
});
await app.register(sensible);

// Helper functions
function calculateSha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function generatePath(mime) {
  const ext = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  }[mime] || 'jpg';
  
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const uuid = randomUUID();
  
  return `${year}/${month}/${uuid}.${ext}`;
}

async function getSignedUrl(method, path, expiresIn = 300) {
  const response = await fetch(`${config.mediaServiceUrl}/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, expiresIn })
  });
  return response.json();
}

// Routes

// Health check
app.get('/health', async () => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', service: 'api', database: 'connected' };
  } catch (err) {
    return { status: 'error', service: 'api', database: 'disconnected' };
  }
});

// Initialize upload
app.post('/upload-init', async (request) => {
  const { filename, mime, bytes, sha256, processing_options } = request.body;
  
  // Validate input
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimes.includes(mime)) {
    throw app.httpErrors.badRequest('Invalid file type');
  }
  
  if (bytes > config.maxUploadBytes) {
    throw app.httpErrors.badRequest(`File too large. Max size: ${config.maxUploadBytes} bytes`);
  }

  // Validate processing options
  const defaultOptions = { method: 'mosaic', mosaic_size: 20 };
  const options = { ...defaultOptions, ...processing_options };
  
  const allowedMethods = ['blur', 'solid', 'none', 'mosaic'];
  if (!allowedMethods.includes(options.method)) {
    throw app.httpErrors.badRequest('Invalid processing method');
  }
  
  if (!Number.isInteger(options.mosaic_size) || options.mosaic_size < 1 || options.mosaic_size > 120) {
    throw app.httpErrors.badRequest('mosaic_size must be integer between 1-120');
  }
  
  // Check for duplicate
  const existing = await pool.query(
    'SELECT id, status, processed_path FROM images WHERE sha256 = $1',
    [sha256]
  );
  
  if (existing.rows.length > 0) {
    const image = existing.rows[0];
    return {
      image_id: image.id,
      status: image.status,
      processed_path: image.processed_path,
      duplicate: true
    };
  }
  
  // Generate paths
  const originalPath = `originals/${generatePath(mime)}`;
  
  // Create image record
  const result = await pool.query(
    `INSERT INTO images (original_path, sha256, mime, bytes, status, processing_options)
     VALUES ($1, $2, $3, $4, 'uploaded', $5)
     RETURNING id`,
    [originalPath, sha256, mime, bytes, JSON.stringify(options)]
  );
  
  const imageId = result.rows[0].id;
  
  // Log event
  await pool.query(
    'INSERT INTO events (image_id, type, data) VALUES ($1, $2, $3)',
    [imageId, 'uploaded', JSON.stringify({ mime, bytes })]
  );
  
  // Get signed upload URL
  const signed = await getSignedUrl('PUT', `/${originalPath}`);
  
  return {
    image_id: imageId,
    upload_url: `${config.mediaExternalUrl}${signed.url}`,
    upload_headers: signed.headers,
    original_path: originalPath
  };
});

// Process image
app.post('/images/:id/process', async (request) => {
  const imageId = request.params.id;
  const { pipeline = 'deface_boxes' } = request.body;
  
  // Verify image exists and is uploaded
  const imageResult = await pool.query(
    'SELECT status, sha256, processing_options FROM images WHERE id = $1',
    [imageId]
  );
  
  if (imageResult.rows.length === 0) {
    throw app.httpErrors.notFound('Image not found');
  }
  
  const image = imageResult.rows[0];
  
  if (image.status === 'processing' || image.status === 'queued') {
    throw app.httpErrors.conflict('Already processing');
  }
  
  if (image.status === 'done') {
    throw app.httpErrors.conflict('Already processed');
  }
  
  // Create dedupe key
  const dedupeKey = `${image.sha256}:${pipeline}`;
  
  // Check for existing job
  const existingJob = await pool.query(
    'SELECT id FROM jobs WHERE dedupe_key = $1',
    [dedupeKey]
  );
  
  if (existingJob.rows.length > 0) {
    return { job_id: existingJob.rows[0].id, duplicate: true };
  }
  
  // Create job
  const jobResult = await pool.query(
    `INSERT INTO jobs (image_id, kind, status, dedupe_key, processing_options)
     VALUES ($1, $2, 'queued', $3, $4)
     RETURNING id`,
    [imageId, pipeline, dedupeKey, JSON.stringify(image.processing_options)]
  );
  
  const jobId = jobResult.rows[0].id;
  
  // Update image status
  await pool.query(
    "UPDATE images SET status = 'queued' WHERE id = $1",
    [imageId]
  );
  
  // Log event
  await pool.query(
    'INSERT INTO events (image_id, type, data) VALUES ($1, $2, $3)',
    [imageId, 'queued', JSON.stringify({ job_id: jobId, pipeline })]
  );
  
  // NOTIFY will be triggered automatically by the database trigger
  
  return { job_id: jobId };
});

// List images
app.get('/images', async (request) => {
  const { status, page = 1, pageSize = 20 } = request.query;
  const offset = (page - 1) * pageSize;
  
  let query = `
    SELECT id, mime, bytes, status, processed_path, created_at, updated_at
    FROM images
  `;
  const params = [];
  
  if (status) {
    query += ' WHERE status = $1';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(pageSize, offset);
  
  const result = await pool.query(query, params);
  
  // Add processed URLs
  const images = result.rows.map(img => ({
    ...img,
    processed_url: img.processed_path ? 
      `${config.mediaExternalUrl}/${img.processed_path}` : null
  }));
  
  return { images, page, pageSize };
});

// Get image details
app.get('/images/:id', async (request) => {
  const imageId = request.params.id;
  
  const result = await pool.query(
    'SELECT * FROM images WHERE id = $1',
    [imageId]
  );
  
  if (result.rows.length === 0) {
    throw app.httpErrors.notFound('Image not found');
  }
  
  const image = result.rows[0];
  
  // Get events
  const events = await pool.query(
    'SELECT type, data, at FROM events WHERE image_id = $1 ORDER BY at DESC',
    [imageId]
  );
  
  // Generate signed URL for original if needed
  let originalUrl = null;
  let originalHeaders = null;
  if (image.original_path) {
    const signed = await getSignedUrl('GET', `/${image.original_path}`, 60);
    originalUrl = `${config.mediaExternalUrl}${signed.url}`;
    originalHeaders = signed.headers;
  }

  return {
    ...image,
    original_url: originalUrl,
    original_headers: originalHeaders,
    processed_url: image.processed_path ? 
      `${config.mediaExternalUrl}/${image.processed_path}` : null,
    events: events.rows
  };
});

// Delete image - complete cleanup
app.delete('/images/:id', async (request) => {
  const imageId = request.params.id;
  console.log(`DELETE request received for image ID: ${imageId}`);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get image details for file cleanup
    const imageResult = await client.query(
      'SELECT original_path, processed_path, sha256 FROM images WHERE id = $1',
      [imageId]
    );
    
    if (imageResult.rows.length === 0) {
      console.log(`Image ${imageId} not found in database`);
      throw app.httpErrors.notFound('Image not found');
    }
    
    const image = imageResult.rows[0];
    console.log(`Deleting image ${imageId} with SHA256: ${image.sha256}`);
    
    // Delete all related jobs first (to maintain referential integrity)
    const jobsDeleted = await client.query('DELETE FROM jobs WHERE image_id = $1', [imageId]);
    console.log(`Deleted ${jobsDeleted.rowCount} jobs for image ${imageId}`);
    
    // Delete all events
    const eventsDeleted = await client.query('DELETE FROM events WHERE image_id = $1', [imageId]);
    console.log(`Deleted ${eventsDeleted.rowCount} events for image ${imageId}`);
    
    // Delete the image record (this will also cascade delete related records)
    const imageDeleted = await client.query('DELETE FROM images WHERE id = $1', [imageId]);
    console.log(`Deleted ${imageDeleted.rowCount} image records for image ${imageId}`);
    
    await client.query('COMMIT');
    console.log(`Database transaction committed for image ${imageId}`);
    
    // Delete files from media service (don't let file deletion failure break the DB transaction)
    const filesToDelete = [];
    if (image.original_path) filesToDelete.push(image.original_path);
    if (image.processed_path) filesToDelete.push(image.processed_path);
    
    // Delete files asynchronously - errors logged but not thrown
    for (const filePath of filesToDelete) {
      try {
        const signed = await getSignedUrl('DELETE', `/${filePath}`);
        const deleteResponse = await fetch(`${config.mediaServiceUrl}${signed.url}`, {
          method: 'DELETE',
          headers: signed.headers
        });
        if (!deleteResponse.ok) {
          console.warn(`Failed to delete file ${filePath}: ${deleteResponse.statusText}`);
        }
      } catch (err) {
        console.warn(`Error deleting file ${filePath}:`, err.message);
      }
    }
    
    return { success: true, message: 'Image and all related data deleted successfully' };
    
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Get job status
app.get('/jobs/:id', async (request) => {
  const jobId = request.params.id;
  
  const result = await pool.query(
    'SELECT * FROM jobs WHERE id = $1',
    [jobId]
  );
  
  if (result.rows.length === 0) {
    throw app.httpErrors.notFound('Job not found');
  }
  
  return result.rows[0];
});

// Queue stats
app.get('/queue', async (request) => {
  const stats = await pool.query('SELECT * FROM get_queue_stats()');
  
  const total = await pool.query(
    'SELECT COUNT(*) as count FROM jobs WHERE created_at > NOW() - interval \'24 hours\''
  );
  
  return {
    stats: stats.rows,
    total_24h: parseInt(total.rows[0].count)
  };
});

// Metrics endpoint
app.get('/metrics', async () => {
  const metrics = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM images) as total_images,
      (SELECT COUNT(*) FROM images WHERE status = 'done') as processed_images,
      (SELECT COUNT(*) FROM jobs WHERE status = 'queued') as queued_jobs,
      (SELECT COUNT(*) FROM jobs WHERE status = 'processing') as processing_jobs,
      (SELECT COUNT(*) FROM jobs WHERE status = 'failed' AND created_at > NOW() - interval '1 hour') as recent_failures
  `);
  
  return metrics.rows[0];
});

// Start server
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`API service running on port ${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
