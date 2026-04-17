# Rigways ACM - Coolify Deployment Guide

## Overview
This deployment package converts the original Cloudflare Worker + Supabase application to a self-hosted Node.js + MySQL stack suitable for Coolify deployment.

## Architecture
- **Backend**: Node.js + Express.js
- **Database**: MySQL 8.0
- **Authentication**: JWT-based (same as original)
- **Frontend**: Static files served by Express (unchanged from original)

## Features Preserved
✅ All original API endpoints
✅ JWT authentication system
✅ Role-based access control (admin, manager, technician, user)
✅ Multi-tenancy (client-based data isolation)
✅ All CRUD operations for:
  - Assets
  - Certificates
  - Clients
  - Inspectors
  - Functional Locations
  - Users
  - Notifications
  - Reports

## Quick Start with Docker Compose

### 1. Clone and Navigate
```bash
cd coolify-deployment
```

### 2. Configure Environment
Create a `.env` file in the `docker` directory:
```bash
MYSQL_ROOT_PASSWORD=your_secure_root_password
MYSQL_PASSWORD=your_secure_db_password
JWT_SECRET=your_super_secret_jwt_key_min_32_chars
CORS_ORIGIN=https://your-domain.com
```

### 3. Start Services
```bash
cd docker
docker-compose up -d
```

### 4. Verify Installation
```bash
# Check logs
docker-compose logs -f backend

# Test health endpoint
curl http://localhost:3000/health
```

## Coolify Deployment

### Option 1: Docker Compose (Recommended)
1. In Coolify, create a new resource
2. Select "Docker Compose"
3. Upload the `docker/docker-compose.yml` file
4. Set environment variables in Coolify UI:
   - `MYSQL_ROOT_PASSWORD`
   - `MYSQL_PASSWORD`
   - `JWT_SECRET`
   - `CORS_ORIGIN`

### Option 2: Separate Services
Deploy MySQL and Backend as separate services in Coolify:

#### MySQL Service:
- Image: `mysql:8.0`
- Environment variables as shown above
- Mount volume for persistence

#### Backend Service:
- Build context: root directory
- Dockerfile: `docker/Dockerfile.backend`
- Environment variables:
  ```
  NODE_ENV=production
  PORT=3000
  DB_HOST=mysql-service-name
  DB_USER=rigways_user
  DB_PASSWORD=<from MySQL>
  DB_NAME=rigways_acm
  JWT_SECRET=<your-secret>
  ```

## Database Schema
The SQL schema is automatically initialized on first run from:
- `sql/001_schema.sql` - Main tables
- `sql/002_certificate_history.sql` - Certificate history tracking
- `sql/003_backfill_functional_location_client.sql` - Data migration
- `sql/004_seed_demo_data.sql` - Demo data

## Default Admin User
After running the seed data, login with:
- **Username**: `admin`
- **Password**: `admin123`

⚠️ **IMPORTANT**: Change this password immediately in production!

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Assets
- `GET /api/assets` - List assets
- `GET /api/assets/:id` - Get asset
- `POST /api/assets` - Create asset
- `PATCH /api/assets/:id` - Update asset
- `DELETE /api/assets/:id` - Delete asset
- `GET /api/assets/stats` - Asset statistics

### Certificates
- `GET /api/certificates` - List certificates
- `GET /api/certificates/:id` - Get certificate
- `POST /api/certificates` - Create certificate
- `PATCH /api/certificates/:id` - Update certificate
- `DELETE /api/certificates/:id` - Delete certificate
- `GET /api/certificates/stats` - Certificate statistics
- `GET /api/certificates/expiring` - Expiring certificates

### Clients (Admin only)
- `GET /api/clients` - List clients
- `GET /api/clients/:id` - Get client
- `POST /api/clients` - Create client
- `PATCH /api/clients/:id` - Update client
- `DELETE /api/clients/:id` - Delete client

### Users
- `GET /api/users` - List users
- `GET /api/users/:id` - Get user
- `POST /api/users` - Create user (Admin)
- `PATCH /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (Admin)

### Inspectors
- `GET /api/inspectors` - List inspectors
- `GET /api/inspectors/:id` - Get inspector
- `POST /api/inspectors` - Create inspector
- `PATCH /api/inspectors/:id` - Update inspector
- `DELETE /api/inspectors/:id` - Delete inspector

### Functional Locations
- `GET /api/functional-locations` - List locations
- `GET /api/functional-locations/:id` - Get location
- `POST /api/functional-locations` - Create location (Admin)
- `PATCH /api/functional-locations/:id` - Update location (Admin)
- `DELETE /api/functional-locations/:id` - Delete location (Admin)

### Notifications
- `GET /api/notifications` - List notifications
- `GET /api/notifications/unread-count` - Unread count
- `POST /api/notifications/mark-all-read` - Mark all read
- `PATCH /api/notifications/:id` - Update notification
- `DELETE /api/notifications/:id` - Delete notification

### Reports
- `GET /api/reports/summary` - Dashboard summary
- `GET /api/reports/expiring` - Expiring certificates
- `GET /api/reports/assets-by-type` - Assets by type
- `GET /api/reports/certificates-by-type` - Certificates by type

## Frontend Integration
Copy your existing frontend files to the `frontend/` directory:
```bash
cp ../index.html ../dashboard.html ../assets.html ../certificates.html ../clients.html ../inspectors.html ../functional-locations.html ../reports.html ../notifications.html ../app.js ../styles.css ./frontend/
```

The backend will serve these files automatically.

## Security Considerations

1. **Change Default Passwords**: Always change the admin password after first login
2. **Use Strong JWT Secret**: Minimum 32 characters
3. **Enable HTTPS**: Use a reverse proxy (nginx, traefik) with SSL
4. **Restrict CORS**: Set specific origin in production
5. **Database Security**: Use strong passwords and restrict network access

## Troubleshooting

### Database Connection Issues
```bash
docker-compose logs mysql
docker-compose logs backend
```

### Reset Database
```bash
docker-compose down -v  # Removes volumes
docker-compose up -d    # Recreates everything
```

### View Logs
```bash
docker-compose logs -f
docker-compose logs -f backend
docker-compose logs -f mysql
```

## Migration from Cloudflare Worker

The key differences from the original:
1. **Database**: Supabase → MySQL (schema compatible)
2. **Storage**: Cloudflare R2 → Local filesystem (`uploads/` directory)
3. **Runtime**: Cloudflare Workers → Node.js Express
4. **Auth**: Web Crypto JWT → jsonwebtoken library (HS256 compatible)

All business logic, permissions, and API contracts remain identical.

## Support
For issues or questions, check the application logs or review the original Worker implementation for reference.
