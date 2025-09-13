import pg from 'pg';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgresql://pxlcensor:devpassword@localhost:5432/pxlcensor',
  mediaServiceUrl: process.env.MEDIA_SERVICE_URL || 'http://localhost:8081',
  mediaSigningSecret: process.env.MEDIA_SIGNING_SECRET || 'dev-secret-change-in-production',
  concurrency: parseInt(process.env.PROCESSOR_CONCURRENCY || '1'),
  workerId: `worker-${process.env.HOSTNAME || randomUUID().slice(0, 8)}`,
  tempDir: process.env.TEMP_DIR || '/tmp/pxlcensor'
};

// Database connection
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.concurrency + 2
});

// Ensure temp directory exists
await fs.mkdir(config.tempDir, { recursive: true });

// Get signed URL from media service
async function getSignedUrl(method, path, expiresIn = 300) {
  const response = await fetch(`${config.mediaServiceUrl}/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, expiresIn })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get signed URL: ${response.statusText}`);
  }
  
  return response.json();
}

// Calculate optimal scale for inference based on file size
// Large files likely mean high resolution, so we scale down for better performance
function getOptimalScale(fileSizeBytes) {
  // For very large files (>10MB), use 720p inference
  if (fileSizeBytes > 10 * 1024 * 1024) {
    return '1280x720';
  }
  // For medium files (2-10MB), use 900p inference  
  else if (fileSizeBytes > 2 * 1024 * 1024) {
    return '1600x900';
  }
  // For smaller files, use 1080p inference
  else {
    return '1920x1080';
  }
}

// Download file from media service
async function downloadFile(path, outputFile) {
  const signed = await getSignedUrl('GET', `/${path}`);
  const url = `${config.mediaServiceUrl}${signed.url}`;
  
  const response = await fetch(url, {
    headers: signed.headers
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }
  
  const buffer = await response.buffer();
  await fs.writeFile(outputFile, buffer);
  
  return outputFile;
}

// Upload file to media service
async function uploadFile(localPath, remotePath) {
  const signed = await getSignedUrl('PUT', `/${remotePath}`);
  const url = `${config.mediaServiceUrl}${signed.url}`;
  
  const fileBuffer = await fs.readFile(localPath);
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...signed.headers,
      'Content-Type': 'application/octet-stream'
    },
    body: fileBuffer
  });
  
  if (!response.ok) {
    throw new Error(`Failed to upload: ${response.statusText}`);
  }
  
  return remotePath;
}

// Run deface command
async function runDeface(inputPath, outputPath, options = {}) {
  // Get file size for optimal scaling
  const fileStats = await fs.stat(inputPath);
  const scale = getOptimalScale(fileStats.size);
  
  return new Promise((resolve, reject) => {
    const args = [
      inputPath,
      '-o', outputPath
    ];
    
    // Add method-specific options
    if (options.method === 'mosaic') {
      args.push('--replacewith', 'mosaic');
      if (options.mosaic_size) {
        args.push('--mosaicsize', options.mosaic_size.toString());
      }
    } else if (options.method === 'blur') {
      args.push('--replacewith', 'blur');
    } else if (options.method === 'solid') {
      args.push('--replacewith', 'solid');
    } else {
      // Default to mosaic
      args.push('--replacewith', 'mosaic');
      if (options.mosaic_size) {
        args.push('--mosaicsize', options.mosaic_size.toString());
      }
    }
    
    // Add scale option for inference (reduces memory usage and improves performance)
    args.push('--scale', scale);
    
    console.log(`Using inference scale: ${scale} (based on file size: ${(fileStats.size / 1024 / 1024).toFixed(1)}MB)`);
    console.log(`Running: /opt/deface-env/bin/deface ${args.join(' ')}`);
    
    const deface = spawn('/opt/deface-env/bin/deface', args);
    
    let stderr = '';
    
    deface.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    deface.on('close', (code, signal) => {
      if (code === null && signal) {
        reject(new Error(`deface was killed by signal ${signal}: ${stderr}`));
      } else if (code !== 0) {
        reject(new Error(`deface failed with code ${code}: ${stderr}`));
      } else {
        resolve({ success: true, output: outputPath, stderr });
      }
    });
    
    deface.on('error', (err) => {
      reject(new Error(`Failed to spawn deface: ${err.message}`));
    });
  });
}

// Process a single job
async function processJob(job) {
  const client = await pool.connect();
  
  try {
    // Get image details
    const imageResult = await client.query(
      'SELECT original_path, mime, bytes, processing_options FROM images WHERE id = $1',
      [job.image_id]
    );
    
    if (imageResult.rows.length === 0) {
      throw new Error('Image not found');
    }
    
    const image = imageResult.rows[0];
    
    // Generate paths
    const tempId = randomUUID();
    const ext = path.extname(image.original_path);
    const tempInput = path.join(config.tempDir, `${tempId}-input${ext}`);
    const tempOutput = path.join(config.tempDir, `${tempId}-output${ext}`);
    
    // Generate processed path (same structure as original)
    const processedPath = image.original_path.replace('originals/', 'processed/');
    
    try {
      // Download original
      await downloadFile(image.original_path, tempInput);
      
      // Debug: Check if file was downloaded
      const inputStats = await fs.stat(tempInput);
      console.log(`Downloaded ${tempInput}, size: ${inputStats.size} bytes`);
      
      // Get processing options from job or image
      const processingOptions = job.processing_options || image.processing_options || {};
      console.log('Raw processing options:', JSON.stringify(processingOptions));
      
      const defaceOptions = {
        method: processingOptions.method || 'mosaic',
        mosaic_size: processingOptions.mosaic_size || 20
      };
      
      console.log('Deface options:', JSON.stringify(defaceOptions));
      
      await runDeface(tempInput, tempOutput, defaceOptions);
      
      // Check if output was created
      const outputStats = await fs.stat(tempOutput);
      if (!outputStats.isFile()) {
        throw new Error('Deface did not create output file');
      }
      
      // Upload processed image
      await uploadFile(tempOutput, processedPath);
      
      // Mark job as complete
      await client.query('SELECT complete_job($1, $2)', [job.id, processedPath]);
      
    } finally {
      // Cleanup temp files
      try {
        await fs.unlink(tempInput);
        await fs.unlink(tempOutput);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
    
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error.message);
    
    // Mark job as failed
    await client.query('SELECT fail_job($1, $2)', [job.id, error.message]);
    
  } finally {
    client.release();
  }
}

// Main worker loop
async function worker() {
  console.log(`Worker ${config.workerId} starting with concurrency ${config.concurrency}`);
  
  // Set up LISTEN connection
  const listenClient = await pool.connect();
  
  // Listen for notifications
  listenClient.on('notification', async (msg) => {
    console.log('Received notification:', msg.payload);
    processNext();
  });
  
  await listenClient.query('LISTEN jobs_channel');
  console.log('Listening for job notifications...');
  
  // Process jobs
  const activeJobs = new Set();
  
  async function processNext() {
    if (activeJobs.size >= config.concurrency) {
      return;
    }
    
    try {
      // Claim a job
      const result = await pool.query(
        'SELECT * FROM claim_jobs($1, $2)',
        [config.workerId, 1]
      );
      
      if (result.rows.length > 0) {
        const job = result.rows[0];
        console.log(`Claimed job ${job.id}`);
        
        activeJobs.add(job.id);
        
        // Process job asynchronously
        processJob(job)
          .finally(() => {
            activeJobs.delete(job.id);
            // Try to process next job
            processNext();
          });
      }
    } catch (err) {
      console.error('Error claiming job:', err.message);
    }
  }
  
  // Initial check for queued jobs
  processNext();
  
  // Periodic check for stuck jobs
  setInterval(() => {
    if (activeJobs.size < config.concurrency) {
      processNext();
    }
  }, 10000);
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    
    // Stop claiming new jobs
    await listenClient.query('UNLISTEN jobs_channel');
    
    // Wait for active jobs to complete
    while (activeJobs.size > 0) {
      console.log(`Waiting for ${activeJobs.size} jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await listenClient.release();
    await pool.end();
    process.exit(0);
  });
  
  // Keep process alive
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}

// Start worker
worker().catch(err => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
