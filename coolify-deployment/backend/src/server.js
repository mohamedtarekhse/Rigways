import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { testConnection } from './lib/db.js';

// Import routes
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import assetsRoutes from './routes/assets.js';
import certificatesRoutes from './routes/certificates.js';
import clientsRoutes from './routes/clients.js';
import inspectorsRoutes from './routes/inspectors.js';
import functionalLocationsRoutes from './routes/functional-locations.js';
import notificationsRoutes from './routes/notifications.js';
import reportsRoutes from './routes/reports.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files - serve frontend
const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/certificates', certificatesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/inspectors', inspectorsRoutes);
app.use('/api/functional-locations', functionalLocationsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/reports', reportsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Start server
async function startServer() {
  // Test database connection
  const dbConnected = await testConnection();
  
  if (!dbConnected) {
    console.error('Failed to connect to database. Exiting...');
    process.exit(1);
  }
  
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🚀 Rigways ACM Server is running!                      ║
║                                                          ║
║   ➜  Local:   http://localhost:${PORT}                    ║
║   ➜  Network: use --host to expose                      ║
║                                                          ║
║   Database:  Connected ✓                                 ║
║   Environment: ${process.env.NODE_ENV || 'development'}                              ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
    `);
  });
}

startServer();

export default app;
