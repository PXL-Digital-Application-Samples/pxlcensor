# Face Anonymization Application - Technical Specification

**Platform Requirements**: Single Docker Compose deployment, 12GB laptop (eventual k3d migration)  
**Stack**: Node.js (Fastify), Vue 3, PostgreSQL, Python (deface CLI)

## Architecture Overview

Five containerized services with clear separation of concerns:

1. **API Service** - Application orchestrator
2. **Media Service** - File storage handler  
3. **Processor Service** - Face anonymization worker
4. **Frontend** - Vue 3 SPA
5. **PostgreSQL** - Database and job queue

## Component Details

### 1. API Service (Node.js/Fastify)

**Responsibilities:**
- REST API endpoints
- Database management
- Job queue orchestration via LISTEN/NOTIFY
- Signed URL generation for media operations
- Frontend static file serving

**Key Libraries:**
- `fastify` - Web framework (Fast and low overhead web framework)
- `pg` - PostgreSQL client with LISTEN/NOTIFY support
- Built-in `crypto` module for HMAC signatures

**Endpoints:**
```
POST /upload-init     - Initialize upload, return signed PUT URL
POST /images/:id/process - Queue anonymization job
GET  /images         - List images with filters
GET  /images/:id     - Get image details
GET  /jobs/:id       - Get job status
GET  /queue          - Queue statistics
GET  /health         - Health check endpoint
GET  /metrics        - Prometheus metrics
```

### 2. Media Service (Node.js)

**Responsibilities:**
- File system operations (sole owner of /media)
- Signed URL verification for uploads
- Public access for processed images
- Atomic file writes (temp → final)

**Security:**
- HMAC-SHA256 signature verification
- PUT operations require valid signatures
- GET operations: public for processed/, signed for originals/

**Storage Structure:**
```
/media/
  originals/YYYY/MM/{uuid}.{ext}
  processed/YYYY/MM/{uuid}.{ext}
  tmp/{uuid}.part
```

### 3. Processor Service (Node.js Worker)

**Responsibilities:**
- Queue consumption via LISTEN/NOTIFY
- deface CLI integration
- Job retry logic with exponential backoff

**deface Integration:**
- Installation: `pip install deface` in Dockerfile
- Command: `deface INPUT --boxes --replacewith solid -o OUTPUT`
- Optional scaling: `--scale 1280x720` for large images
- Supported formats: jpg, jpeg, png, webp

**Processing Flow:**
1. LISTEN on `jobs_channel`
2. Claim jobs with SELECT FOR UPDATE SKIP LOCKED
3. Download original via signed URL
4. Execute deface command
5. Upload processed image
6. Update job status and events

### 4. Frontend (Vue 3 + Vite)

**Pages:**
- **Upload**: Drag-drop interface, progress tracking
- **Queue**: Job status table with counters
- **Gallery**: Grid view of processed images
- **Detail**: Full image view with processing timeline

**Build Process:**
- Development: Vite dev server
- Production: Static build served by API

### 5. PostgreSQL Database

**Schema:**

```sql
-- Images table
CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_path TEXT NOT NULL,
  processed_path TEXT,
  sha256 CHAR(64) NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'queued', 'processing', 'done', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs queue table  
CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  image_id UUID REFERENCES images(id),
  kind TEXT NOT NULL DEFAULT 'deface_boxes',
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  run_at TIMESTAMPTZ DEFAULT NOW(),
  attempts INTEGER DEFAULT 0,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  dedupe_key TEXT UNIQUE,
  error_log TEXT
);

-- Events audit table
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  image_id UUID REFERENCES images(id),
  at TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL,
  data JSONB
);

-- Indexes
CREATE INDEX idx_jobs_queue ON jobs(status, run_at) WHERE status = 'queued';
CREATE INDEX idx_images_status ON images(status);
CREATE UNIQUE INDEX idx_jobs_dedupe ON jobs(dedupe_key);
```

## Queue Implementation (PostgreSQL LISTEN/NOTIFY)

**Enqueue Process:**
```javascript
// API service
await client.query(`
  INSERT INTO jobs (image_id, dedupe_key, status)
  VALUES ($1, $2, 'queued')
`, [imageId, dedupeKey]);
await client.query("NOTIFY jobs_channel");
```

**Worker Process:**
```javascript
// Processor service
await client.query('LISTEN jobs_channel');
client.on('notification', async () => {
  const job = await client.query(`
    SELECT * FROM jobs 
    WHERE status = 'queued' AND run_at <= NOW()
    ORDER BY run_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `);
  // Process job...
});
```

PostgreSQL LISTEN/NOTIFY provides a lightweight pub/sub mechanism entirely in memory, perfect for our resource-constrained environment.

## Security Implementation

### HMAC Signature Generation

Using Node.js built-in crypto module:

```javascript
import { createHmac } from 'crypto';

// Generate signature
function generateSignature(method, path, expires, secret) {
  return createHmac('sha256', secret)
    .update(`${method}:${path}:${expires}`)
    .digest('hex');
}

// Verify signature
function verifySignature(signature, method, path, expires, secret) {
  const expected = generateSignature(method, path, expires, secret);
  return signature === expected;
}
```

**Signature Parameters:**
- TTL: 300 seconds default
- Payload: `METHOD:PATH:EXPIRES`
- Algorithm: HMAC-SHA256

## Docker Compose Configuration

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    networks:
      - app_network

  api:
    build: ./api
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgresql://app:${POSTGRES_PASSWORD}@postgres:5432/app
      MEDIA_SIGNING_SECRET: ${MEDIA_SIGNING_SECRET}
      MEDIA_SERVICE_URL: http://media:8081
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - app_network
    volumes:
      - ./frontend/dist:/app/public:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  media:
    build: ./media
    ports:
      - "8081:8081"
    environment:
      MEDIA_ROOT: /media
      MEDIA_SIGNING_SECRET: ${MEDIA_SIGNING_SECRET}
    volumes:
      - ./media-data:/media
    networks:
      - app_network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8081/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  processor:
    build: ./processor
    environment:
      DATABASE_URL: postgresql://app:${POSTGRES_PASSWORD}@postgres:5432/app
      MEDIA_SERVICE_URL: http://media:8081
      MEDIA_SIGNING_SECRET: ${MEDIA_SIGNING_SECRET}
      PROCESSOR_CONCURRENCY: 1
    depends_on:
      postgres:
        condition: service_healthy
      media:
        condition: service_healthy
    networks:
      - app_network
    deploy:
      replicas: 1
      resources:
        limits:
          memory: 2G
          cpus: '1.0'

  frontend-build:
    build: ./frontend
    command: npm run build
    volumes:
      - ./frontend/dist:/app/dist
    profiles:
      - build

volumes:
  postgres_data:

networks:
  app_network:
    driver: bridge
```

## Environment Configuration (.env)

```bash
# Database
POSTGRES_PASSWORD=change-me-production

# Security
MEDIA_SIGNING_SECRET=64-char-hex-string-change-in-production

# Limits
MAX_UPLOAD_MB=25
PROCESSOR_CONCURRENCY=1

# Development
NODE_ENV=development
```

## Performance Optimizations

1. **Resource Management:**
   - Single processor worker by default (PROCESSOR_CONCURRENCY=1)
   - Memory limits in Docker Compose
   - Image downscaling option for large files

2. **Database Optimizations:**
   - SKIP LOCKED for concurrent job processing
   - Appropriate indexes for queue queries
   - Connection pooling in Node.js

3. **File Handling:**
   - Atomic writes (temp → rename)
   - Date-based directory partitioning
   - SHA256 deduplication

## Validation & Limits

- **File Types**: jpg, jpeg, png, webp only
- **Max Upload Size**: 25MB (configurable)
- **Deduplication**: Via SHA256 + pipeline type
- **Rate Limiting**: Per-IP on upload endpoint
- **Request Timeout**: 30 seconds for processing

## Observability

- Structured JSON logging with correlation IDs
- `/health` endpoints on all services
- `/metrics` endpoint for Prometheus
- Queue depth and job duration metrics
- Docker health checks with pg_isready for PostgreSQL and HTTP checks for services

## Security Considerations

1. **Container Security:**
   - Non-root user in containers
   - Read-only root filesystem where possible
   - Network isolation via Docker networks

2. **Application Security:**
   - HMAC-signed URLs (no public upload)
   - Rate limiting on upload endpoints
   - Input validation on all endpoints
   - No authentication required (public gallery)

## Development Workflow

1. **Initial Setup:**
   ```bash
   git clone <repository>
   cd face-anonymizer
   cp .env.example .env
   # Edit .env with secure values
   ```

2. **Build and Run:**
   ```bash
   # Build all services
   docker compose build
   
   # Run database migrations
   docker compose run --rm api npm run migrate
   
   # Start all services
   docker compose up
   ```

3. **Development Mode:**
   ```bash
   # Run with hot-reload
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up
   ```

4. **Scaling Processors:**
   ```bash
   docker compose up --scale processor=2
   ```

## Migration to k3d

When ready for Kubernetes:
1. Convert docker-compose.yml to Kubernetes manifests
2. Use ConfigMaps for configuration
3. Use Secrets for sensitive data
4. Consider horizontal pod autoscaling for processor
5. Use persistent volume claims for media storage

## Key Design Decisions

1. **PostgreSQL as Queue**: Avoids additional infrastructure (Redis/RabbitMQ), uses SKIP LOCKED for reliable exactly-once processing

2. **Separate Media Service**: Isolates file system access, improves security

3. **HMAC Signatures**: Simple, effective security without user authentication

4. **deface CLI**: Proven, maintained tool with CenterFace neural network for reliable face detection

5. **Fastify Framework**: High performance with low overhead and powerful plugin architecture

## Notes

- This design balances production-readiness with development simplicity
- All technical choices are optimized for 12GB RAM constraint
- Architecture supports future scaling and k3d migration
- Security implemented without requiring user accounts
