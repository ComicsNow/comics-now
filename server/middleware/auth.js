const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { isAuthEnabled, getAdminEmail, getCloudflareConfig, getTrustedIPs } = require('../config');
const { dbRun, dbGet } = require('../db');

let jwksClientInstance = null;

/**
 * Initialize JWKS client for JWT verification
 * Only called when authentication is enabled
 */
function initJwksClient() {
  if (!isAuthEnabled()) return null;

  const cfConfig = getCloudflareConfig();
  const teamDomain = cfConfig.teamDomain || process.env.CF_TEAM_DOMAIN;

  if (!teamDomain) {
    
    return null;
  }

  if (!jwksClientInstance) {
    jwksClientInstance = jwksClient({
      jwksUri: `https://${teamDomain}/cdn-cgi/access/certs`
    });
    
  }

  return jwksClientInstance;
}

/**
 * Get signing key for JWT verification
 */
function getKey(header, callback) {
  const client = initJwksClient();
  if (!client) {
    return callback(new Error('JWKS client not initialized'));
  }

  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

/**
 * Check if an IP matches a pattern (supports wildcards like 192.168.0.*)
 */
function isIPInTrustedList(clientIP, trustedIPs) {
  for (const pattern of trustedIPs) {
    // Exact match
    if (clientIP === pattern) return true;

    // Wildcard match (e.g., 192.168.0.*)
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (regex.test(clientIP)) return true;
    }
  }
  return false;
}

/**
 * Extract user from Cloudflare Zero Trust JWT
 * If auth is disabled, creates a default admin user
 */
async function extractUserFromJWT(req, res, next) {
  // ===== PUBLIC ROUTES (no auth required) =====
  // These assets are needed for the PWA to load and display the login UI
  const publicPaths = [
    'manifest.json',
    'service-worker.js',
    'favicon.ico',
    '/icons/',
    '/screenshots/',
    '/js/',
    'tailwind.css',
    'style.css',
    'jszip.min.js',
    'index.html'
  ];

  const isPublicPath = publicPaths.some(publicPath => {
    // Match paths that contain or end with the public path
    return req.path.includes(publicPath) || req.url.includes(publicPath);
  });

  if (isPublicPath) {
    return next();
  }

  // ===== AUTH DISABLED MODE =====
  if (!isAuthEnabled()) {
    // For testing: Allow mocking different users via X-Test-User-Id header
    const testUserId = req.headers['x-test-user-id'];
    const testUserEmail = req.headers['x-test-user-email'];
    const testUserRole = req.headers['x-test-user-role'];

    let userId = 'default-user';
    let email = 'local@localhost';
    let role = 'admin';

    // Allow mock users when auth is disabled (for testing)
    if (testUserId) {
      userId = testUserId;
      email = testUserEmail || `${testUserId}@test.local`;
      role = testUserRole || 'user';
      `);
    }

    req.user = {
      userId,
      email,
      role
    };

    // Ensure user exists in database
    try {
      await dbRun(`
        INSERT INTO users (userId, email, role, lastSeen)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(userId) DO UPDATE SET lastSeen = excluded.lastSeen
      `, [userId, email, role, Date.now()]);
    } catch (error) {
      
    }

    return next();
  }

  // ===== AUTH ENABLED MODE =====

  const jwtToken = req.headers['cf-access-jwt-assertion'];

  // Check if request is from a trusted IP (bypass auth ONLY if no JWT token present)
  // This allows Cloudflare-authenticated users to use their real identity even from trusted IPs
  if (!jwtToken) {
    const trustedIPs = getTrustedIPs();
    if (trustedIPs.length > 0) {
      const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
      const normalizedIP = clientIP?.replace(/^::ffff:/, ''); // Remove IPv6 prefix

      }`);

      if (isIPInTrustedList(normalizedIP, trustedIPs)) {
        
        req.user = {
          userId: 'default-user',
          email: 'local@localhost',
          role: 'admin'
        };

        // Ensure local admin user exists in database (same user as auth-disabled mode)
        try {
          await dbRun(`
            INSERT INTO users (userId, email, role, lastSeen)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(userId) DO UPDATE SET
              email = excluded.email,
              role = excluded.role,
              lastSeen = excluded.lastSeen
          `, ['default-user', 'local@localhost', 'admin', Date.now()]);
        } catch (error) {
          
        }

        return next();
      }
    }
  }

  // Debug logging
  if (!jwtToken && req.path.includes('/api/')) {
    
    );
  }

  // Development bypass (only if NODE_ENV is development)
  if (!jwtToken && process.env.NODE_ENV === 'development') {
    
    req.user = {
      email: 'dev@localhost',
      userId: 'dev-user-1',
      role: 'admin'
    };

    // Create dev user in database
    try {
      await dbRun(`
        INSERT INTO users (userId, email, role, lastSeen)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(userId) DO UPDATE SET lastSeen = excluded.lastSeen
      `, ['dev-user-1', 'dev@localhost', 'admin', Date.now()]);
    } catch (error) {
      
    }

    return next();
  }

  if (!jwtToken) {
    return res.status(401).json({
      error: 'Unauthorized - No authentication token provided',
      hint: 'Access this app through Cloudflare Zero Trust'
    });
  }

  try {
    const cfConfig = getCloudflareConfig();
    const teamDomain = cfConfig.teamDomain || process.env.CF_TEAM_DOMAIN;
    const audience = cfConfig.audience || process.env.CF_AUDIENCE;

    if (!teamDomain || !audience) {
      throw new Error('Cloudflare configuration incomplete');
    }

    // Verify JWT
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(jwtToken, getKey, {
        audience: audience,
        issuer: `https://${teamDomain}`
      }, (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      });
    });

    const email = decoded.email;
    const userId = decoded.sub; // Subject = unique user ID
    const adminEmail = getAdminEmail();
    const isAdmin = email === adminEmail;

    // Upsert user in database
    await dbRun(`
      INSERT INTO users (userId, email, role, lastSeen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        email = excluded.email,
        role = excluded.role,
        lastSeen = excluded.lastSeen
    `, [userId, email, isAdmin ? 'admin' : 'user', Date.now()]);

    // Get user from database (in case role was updated)
    const user = await dbGet('SELECT * FROM users WHERE userId = ?', [userId]);

    req.user = {
      userId: user.userId,
      email: user.email,
      role: user.role
    };

    next();
  } catch (error) {
    
    return res.status(401).json({
      error: 'Invalid authentication token',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Require admin role
 * When auth is disabled, all users are admin
 */
function requireAdmin(req, res, next) {
  // When auth is disabled, everyone is admin
  if (!isAuthEnabled()) {
    return next();
  }

  // When auth is enabled, check role
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden: Admin access required',
      hint: 'This feature is only available to administrators'
    });
  }
  next();
}

/**
 * Require any authenticated user
 * When auth is disabled, all requests are allowed
 */
function requireAuth(req, res, next) {
  // When auth is disabled, everyone is authenticated
  if (!isAuthEnabled()) {
    return next();
  }

  // When auth is enabled, check user exists
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      hint: 'Please sign in to access this resource'
    });
  }
  next();
}

module.exports = {
  extractUserFromJWT,
  requireAdmin,
  requireAuth,
  initJwksClient
};
