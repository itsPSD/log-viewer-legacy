// Load environment variables first
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const config = require('./config');
const mysql = require('mysql2/promise');
const path = require('path');
const moment = require('moment-timezone');
const helmet = require('helmet');
const compression = require('compression');


const isProduction = process.env.NODE_ENV === 'production';

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy - required for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Validate required environment variables
const requiredEnvVars = [
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'SESSION_SECRET',
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Error: Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 20, // Increase connection limit
    queueLimit: 0,
    connectTimeout: 10000, // 10 seconds connection timeout
    acquireTimeout: 10000, // 10 seconds acquire timeout
    timeout: 30000 // 30 seconds query timeout
};

// Create database connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log('Database connection successful');
        connection.release();
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
})();

// Add indexes to the user_logs table
(async () => {
    try {
        const connection = await pool.getConnection();
        const queries = [
            // Single column indexes
            `CREATE INDEX IF NOT EXISTS idx_identifier ON user_logs (identifier)`,
            `CREATE INDEX IF NOT EXISTS idx_action ON user_logs (action)`,
            `CREATE INDEX IF NOT EXISTS idx_details ON user_logs (details(255))`,
            `CREATE INDEX IF NOT EXISTS idx_metadata ON user_logs (metadata(255))`,
            `CREATE INDEX IF NOT EXISTS idx_timestamp ON user_logs (timestamp)`,
            // Composite indexes for common filter combinations
            `CREATE INDEX IF NOT EXISTS idx_identifier_action ON user_logs (identifier, action)`,
            `CREATE INDEX IF NOT EXISTS idx_identifier_timestamp ON user_logs (identifier, timestamp DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_action_timestamp ON user_logs (action, timestamp DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_identifier_action_timestamp ON user_logs (identifier, action, timestamp DESC)`,
            // Composite indexes for details searches with other filters
            `CREATE INDEX IF NOT EXISTS idx_identifier_details ON user_logs (identifier, details(100))`,
            `CREATE INDEX IF NOT EXISTS idx_action_details ON user_logs (action, details(100))`
        ];
        
        for (const query of queries) {
            await connection.query(query);
        }
        
        connection.release();
        console.log('Indexes created successfully');
    } catch (error) {
        console.error('Failed to create indexes:', error);
    }
})();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
            imgSrc: ["'self'", "https:", "http:", "data:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https:", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    }
}));

// Compression for production
if (isProduction) {
    app.use(compression());
}

// Session store
const sessionStore = new MySQLStore({
    ...dbConfig,
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 86400000,
    createDatabaseTable: true // Ensure table exists
});

// Session configuration with security options
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true, 
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    },
    name: 'sessionId'
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Passport Discord Strategy with error handling
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify'],
    proxy: true // Enable proxy support
}, async (accessToken, refreshToken, profile, done) => {
    try {
        if (config.allowedUsers.includes(profile.id)) {
            return done(null, profile);
        }
        return done(null, false, { message: 'Unauthorized Discord user' });
    } catch (error) {
        return done(error);
    }
}));

// Serialize the entire profile
passport.serializeUser((user, done) => {
    done(null, user);
});

// Deserialize with error handling
passport.deserializeUser((user, done) => {
    try {
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Auth middleware with better error handling
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    
    // Clear any existing session if not authenticated
    if (req.session) {
        req.session.destroy((err) => {
            if (err) console.error('Session destruction error:', err);
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            res.redirect('/login');
        });
    } else {
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        res.redirect('/login');
    }
}

// Rate limiting with different settings for production
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 50 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many login attempts, please try again later.',
    skipSuccessfulRequests: true 
});


app.use((req, res, next) => {
    req.startTime = Date.now();
    console.log(`Request received: ${req.method} ${req.url}`);
    next();
});

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: isProduction ? 100 : 200, // Limit each IP to 100 requests per minute in production
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please try again later.',
    skipSuccessfulRequests: false
});

app.use('/api/', apiLimiter);


app.use((req, res, next) => {
    res.on('finish', () => {
        console.log(`Request completed: ${req.method} ${req.url} - ${res.statusCode} in ${Date.now() - req.startTime}ms`);
    });
    next();
});

// Production logging
if (isProduction) {
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
        });
        next();
    });
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input validation helper
function validateInput(input, maxLength = 500) {
    if (typeof input !== 'string') return '';
    return input.trim().slice(0, maxLength);
}

function sanitizeForSQL(input) {
    if (typeof input !== 'string') return '';
    // Remove potentially dangerous characters but keep necessary ones
    return input.replace(/[;\x00\n\r\\'"\x1a]/g, '');
}

// Serve static files with authentication except for login page
app.use('/public', (req, res, next) => {
    // Allow access to login.html and its assets without auth
    if (req.path.endsWith('login.html') || req.path.includes('/assets/')) {
        return next();
    }
    // For all other static files, check authentication
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
});

app.use(express.static('public', {
    index: false  // Disable auto-serving of index.html
}));

// Auth routes
app.use('/auth/', authLimiter);
app.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', {
        failureRedirect: '/login?error=auth_failed',
        keepSessionInfo: true // Preserve session info across redirects
    }),
    (req, res) => {
        res.redirect('/');
    }
);

app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
            }
            res.redirect('/login');
        });
    });
});

// Move the root route below auth routes and protect it
app.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Protect all API routes
app.use('/api', isAuthenticated);

// Routes

// Add action suggestions endpoint
app.get('/api/actions', async (req, res) => {
    let connection = null;
    try {
        const searchTerm = validateInput(req.query.search || '', 100);
        
        // Don't search if term is too short or empty
        if (searchTerm.length < 1) {
            return res.json([]);
        }
        
        connection = await pool.getConnection();
        
        // Set query timeout
        try {
            await connection.query('SET SESSION max_execution_time = 10000'); // 10 seconds for suggestions
        } catch (timeoutError) {
            // Ignore if not supported
        }
        
        // Optimize: use prefix matching when possible for better index usage
        const searchPattern = searchTerm.length > 2 ? `${searchTerm}%` : `%${searchTerm}%`;
        
        const query = `
            SELECT action, COUNT(*) as count 
            FROM user_logs 
            WHERE action LIKE ? 
            GROUP BY action 
            ORDER BY 
                CASE 
                    WHEN action = ? THEN 1
                    WHEN action LIKE ? THEN 2
                    ELSE 3 
                END,
                count DESC 
            LIMIT 10
        `;
        
        const params = [
            searchPattern,    
            searchTerm,       
            `${searchTerm}%`  
        ];
        
        // Execute with timeout protection
        const queryPromise = connection.execute(query, params);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Query timeout')), 10000);
        });
        
        const result = await Promise.race([queryPromise, timeoutPromise]);
        const [rows] = result;
        
        if (connection) {
            connection.release();
        }
        
        res.json(rows);
    } catch (error) {
        if (connection) {
            connection.release();
        }
        console.error('Database error:', error);
        
        if (error instanceof Error && error.message === 'Query timeout') {
            res.status(504).json({ error: 'Query timeout' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

app.get('/api/logs', async (req, res) => {
    let connection = null;
    try {
        const startTime = process.hrtime();
        connection = await pool.getConnection();
        
        // Set query timeout (30 seconds) - may not be available in all MySQL versions
        try {
            await connection.query('SET SESSION max_execution_time = 30000');
        } catch (timeoutError) {
            // Ignore if max_execution_time is not supported (older MySQL versions)
            // We still have Promise.race timeout protection
        }
        
        let query = 'SELECT id, identifier, action, details, metadata, timestamp FROM user_logs WHERE 1=1';
        const params = [];

        // Validate and sanitize inputs
        // Optimize identifier filter - use prefix matching when possible
        if (req.query.identifier) {
            const identifierValue = validateInput(req.query.identifier, 200);
            if (identifierValue.length > 0) {
                // If identifier starts with "license:" or looks like a license, use prefix matching
                if (identifierValue.startsWith('license:') || /^[a-f0-9]{32,}$/i.test(identifierValue)) {
                    // Use prefix matching for better index usage
                    query += ' AND identifier LIKE ?';
                    params.push(`${identifierValue}%`);
                } else {
                    // For other identifiers, try to use prefix if it doesn't start with wildcard
                    // Otherwise fall back to full LIKE (less efficient but necessary)
                    query += ' AND identifier LIKE ?';
                    params.push(`%${identifierValue}%`);
                }
            }
        }

        // Optimize action filter - prefer exact matches, use prefix matching when possible
        if (req.query.action) {
            const actionInput = validateInput(req.query.action, 500);
            const actions = actionInput.split('|').map(a => a.trim()).filter(a => a.length > 0 && a.length <= 100);
            if (actions.length > 0 && actions.length <= 20) { // Limit to 20 actions max
                const conditions = [];
                
                actions.forEach(action => {
                    if (action.startsWith('=')) {
                        // Exact match (remove the = prefix) - most efficient
                        const exactAction = sanitizeForSQL(action.substring(1));
                        if (exactAction.length > 0) {
                            conditions.push('action = ?');
                            params.push(exactAction);
                        }
                    } else if (action.length > 3) {
                        // For longer actions, use prefix matching when possible
                        // This allows index usage
                        const sanitizedAction = sanitizeForSQL(action);
                        if (sanitizedAction.length > 0) {
                            conditions.push('action LIKE ?');
                            params.push(`${sanitizedAction}%`);
                        }
                    } else {
                        // For short actions, use full LIKE (less efficient but necessary)
                        const sanitizedAction = sanitizeForSQL(action);
                        if (sanitizedAction.length > 0) {
                            conditions.push('action LIKE ?');
                            params.push(`%${sanitizedAction}%`);
                        }
                    }
                });
                
                if (conditions.length > 0) {
                    query += ` AND (${conditions.join(' OR ')})`;
                }
            }
        }

        // Optimize details filter - require minimum length and prefer prefix matching
        if (req.query.details) {
            const detailsValue = validateInput(req.query.details, 500);
            // Require minimum 3 characters to avoid very expensive short searches
            if (detailsValue.length >= 3) {
                // Try to use prefix matching when possible (much faster with index)
                // Only use full wildcard search if we have other filters to narrow it down
                const hasOtherFilters = req.query.identifier || req.query.action || req.query.server || req.query.before || req.query.after;
                
                if (detailsValue.length >= 4 && !detailsValue.includes(' ') && !detailsValue.includes('%')) {
                    // Use prefix matching for better index usage (fastest)
                    query += ' AND details LIKE ?';
                    params.push(`${detailsValue}%`);
                } else if (hasOtherFilters) {
                    // Only use full wildcard if we have other filters to narrow results
                    // This prevents full table scans
                    query += ' AND details LIKE ?';
                    params.push(`%${detailsValue}%`);
                } else {
                    // For full wildcard without other filters, require longer search term
                    // to reduce the search space
                    if (detailsValue.length >= 6) {
                        query += ' AND details LIKE ?';
                        params.push(`%${detailsValue}%`);
                    }
                    // If too short and no other filters, skip details filter to prevent timeout
                }
            }
        }

        // Optimize server filter - use JSON_UNQUOTE for better performance
        if (req.query.server) {
            const serverId = validateInput(req.query.server, 10);
            if (serverId.length > 0 && /^\d+$/.test(serverId)) {
                query += ' AND JSON_UNQUOTE(JSON_EXTRACT(metadata, "$.playerServerId")) = ?';
                params.push(serverId);
            }
        }

        // Filtering by minigames - optimized to use index when possible
        if (req.query.minigames === 'none') {
            // Use exact action matches first (can use index), then check metadata
            query += ` AND (
                (action NOT IN (?, ?, ?) AND action IS NOT NULL)
                OR (metadata LIKE ? AND metadata IS NOT NULL)
            )`;
            params.push('Player Died', 'Player Killed', 'Killed Player');
            params.push('%"minigames":[]%');
        }

        // Timestamp filters - already optimized with index
        if (req.query.before) {
            const beforeTimestamp = parseInt(req.query.before);
            if (!isNaN(beforeTimestamp) && beforeTimestamp > 0) {
                query += ' AND timestamp < FROM_UNIXTIME(?)';
                params.push(beforeTimestamp);
            }
        }

        if (req.query.after) {
            const afterTimestamp = parseInt(req.query.after);
            if (!isNaN(afterTimestamp) && afterTimestamp > 0) {
                query += ' AND timestamp > FROM_UNIXTIME(?)';
                params.push(afterTimestamp);
            }
        }

        // Add pagination with validation
        const page = Math.max(1, Math.min(1000, parseInt(req.query.page) || 1)); // Limit to 1000 pages max
        const limit = 30;
        const offset = (page - 1) * limit;
        
        // Order by timestamp DESC to use index efficiently
        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        // Execute query with timeout protection
        const queryPromise = connection.execute(query, params);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Query timeout')), 30000);
        });
        
        const result = await Promise.race([queryPromise, timeoutPromise]);
        const [rows] = result;
        
        if (connection) {
            connection.release();
        }

        // Calculate query time in milliseconds using high-resolution time
        const endTime = process.hrtime(startTime);
        const queryTimeMs = Math.round((endTime[0] * 1000) + (endTime[1] / 1000000));

        res.json({
            logs: rows,
            page: page,
            queryTime: queryTimeMs,
            time: Date.now()
        });
    } catch (error) {
        if (connection) {
            connection.release();
        }
        console.error('Database error:', error);
        
        // Check if it's a timeout error
        if (error instanceof Error && error.message === 'Query timeout') {
            res.status(504).json({ error: 'Query timeout - try refining your search filters' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Error middleware (must be last)
app.use((err, req, res, next) => {
    console.error(`Error processing request: ${req.method} ${req.url} - ${err.message}`);
    if (err.stack && !isProduction) {
        console.error(err.stack);
    }
    
    if (res.headersSent) {
        return next(err);
    }
    
    res.status(err.status || 500).json({ 
        error: isProduction ? 'Internal server error' : err.message 
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
