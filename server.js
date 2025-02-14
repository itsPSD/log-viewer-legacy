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

// Production check
const isProduction = process.env.NODE_ENV === 'production';

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

const app = express();
const port = process.env.PORT || 3000;

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
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
    checkExpirationInterval: 900000, // 15 minutes
    expiration: 86400000, // 24 hours
});

// Session configuration with security options
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction, // Only use secure cookies in production
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Passport Discord Strategy with error handling
passport.use(new DiscordStrategy({
    clientID: config.discord.clientId,
    clientSecret: config.discord.clientSecret,
    callbackURL: config.discord.callbackURL,
    scope: ['identify']
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

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Rate limiting with different settings for production
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isProduction ? 50 : 100, // Stricter in production
    message: 'Too many login attempts, please try again later.'
});

// Auth middleware
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.redirect('/login');
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    if (isProduction) {
        // Don't leak error details in production
        res.status(500).json({ error: 'Internal Server Error' });
    } else {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
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
app.use(express.json());

// Serve static files with authentication except for login page
app.use(express.static('public', {
    index: false,  // Disable auto-serving of index.html
    setHeaders: (res, path) => {
        // Allow access to login.html and its assets without auth
        if (path.endsWith('login.html') || path.includes('/assets/')) {
            return;
        }
        // For all other static files, check authentication
        return (req, res, next) => {
            if (req.isAuthenticated()) {
                next();
            } else {
                res.redirect('/login');
            }
        };
    }
}));

// Auth routes
app.use('/auth/', authLimiter);
app.get('/login', (req, res) => {
    // If already authenticated, redirect to home
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    // Pass any error message from authentication
    const error = req.query.error;
    res.sendFile(__dirname + '/public/login.html');
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', {
        failureRedirect: '/login?error=unauthorized',
        successRedirect: '/'
    })
);

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/login');
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
    try {
        const connection = await pool.getConnection();
        const searchTerm = req.query.search || '';
        
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
        
        const searchPattern = searchTerm ? `%${searchTerm}%` : '%';
        const params = [
            searchPattern,    // For WHERE clause
            searchTerm,       // For exact match in ORDER BY
            `${searchTerm}%`  // For prefix match in ORDER BY
        ];
        
        const [rows] = await connection.execute(query, params);
        connection.release();
        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/logs', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        let query = 'SELECT id, identifier, action, details, metadata, timestamp FROM user_logs WHERE 1=1';
        const params = [];

        // Add filters
        if (req.query.identifier) {
            query += ' AND identifier LIKE ?';
            params.push(`%${req.query.identifier}%`);
        }

        if (req.query.action) {
            const actions = req.query.action.split('|').map(a => a.trim());
            if (actions.length > 0) {
                const conditions = [];
                
                actions.forEach(action => {
                    if (action.startsWith('=')) {
                        // Exact match (remove the = prefix)
                        conditions.push('action = ?');
                        params.push(action.substring(1));
                    } else {
                        // Like match
                        conditions.push('action LIKE ?');
                        params.push(`%${action}%`);
                    }
                });
                
                if (conditions.length > 0) {
                    query += ` AND (${conditions.join(' OR ')})`;
                }
            }
        }

        if (req.query.details) {
            query += ' AND details LIKE ?';
            params.push(`%${req.query.details}%`);
        }

        if (req.query.server) {
            query += ' AND JSON_EXTRACT(metadata, "$.playerServerId") = ?';
            params.push(req.query.server);
        }

        // Filtering by minigames - exact implementation from reference
        if (req.query.minigames === 'none') {
            query += ` AND (
                action NOT IN (?, ?, ?)
                OR metadata LIKE ?
            )`;
            params.push('Player Died', 'Player Killed', 'Killed Player');
            params.push('%"minigames":[]%');
        }

        if (req.query.before) {
            query += ' AND UNIX_TIMESTAMP(timestamp) < ?';
            params.push(parseInt(req.query.before));
        }

        if (req.query.after) {
            query += ' AND UNIX_TIMESTAMP(timestamp) > ?';
            params.push(parseInt(req.query.after));
        }

        // Add pagination
        const page = parseInt(req.query.page) || 1;
        const limit = 30;
        const offset = (page - 1) * limit;
        
        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [rows] = await connection.execute(query, params);
        connection.release();

        res.json({
            logs: rows,
            page: page,
            time: Date.now()
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
