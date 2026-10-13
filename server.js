require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// CRITICAL: Validate security configuration on startup
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'SESSION_SECRET'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('\n❌ CRITICAL SECURITY ERROR:');
    console.error('The following required environment variables are not set:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    console.error('\nPlease set these in your .env file before starting the server.');
    console.error('JWT_SECRET and SESSION_SECRET must be strong random strings (32+ characters).');
    console.error('Generate them with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
    process.exit(1);
}

// Warn if using weak secrets
if (process.env.JWT_SECRET.length < 32) {
    console.error('\n⚠️  WARNING: JWT_SECRET is too short (must be at least 32 characters)');
    console.error('This is a critical security vulnerability. Please update your .env file.\n');
    process.exit(1);
}

if (process.env.SESSION_SECRET.length < 32) {
    console.error('\n⚠️  WARNING: SESSION_SECRET is too short (must be at least 32 characters)');
    console.error('This is a critical security vulnerability. Please update your .env file.\n');
    process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "https://fffinfo.tsunstudio.pw", "https://pk.fffinfo.tsunstudio.pw"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// CORS Configuration
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Middleware
app.use(cookieParser());
app.use(express.json());

// JWT Authentication Middleware
const authenticateToken = async (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Additional validation: check if user still exists in database
        const result = await pool.query('SELECT id, username FROM users WHERE id = $1', [decoded.id]);
        if (result.rows.length === 0) {
            res.clearCookie('token');
            return res.status(403).json({ error: 'User no longer exists.' });
        }

        // Session binding: validate IP and user agent
        const ip = req.ip;
        const userAgent = req.get('user-agent');
        if (!validateSession(decoded.id, ip, userAgent)) {
            console.error(`Session binding validation failed for user ${decoded.id}`);
            res.clearCookie('token');
            return res.status(403).json({ error: 'Session invalid. Please login again.' });
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            console.error('JWT verification failed - possible forgery attempt');
        }
        res.clearCookie('token');
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }
};

// Login Rate Limiting with Exponential Backoff
const loginAttempts = new Map(); // Store attempts: { attempts: number, lastAttempt: timestamp, lockoutUntil: timestamp }

const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many login attempts. Please try again later.', lockout: true },
    skip: (req) => {
        const ip = req.ip;
        const data = loginAttempts.get(ip);
        if (!data) return false;

        // Check if currently locked out
        if (data.lockoutUntil && Date.now() < data.lockoutUntil) {
            return false; // Still locked out, let rate limiter handle it
        }

        // Reset if lockout expired
        if (data.lockoutUntil && Date.now() >= data.lockoutUntil) {
            loginAttempts.set(ip, { attempts: 0, lastAttempt: 0, lockoutUntil: null });
            return false;
        }

        return false;
    },
    handler: (req, res) => {
        const ip = req.ip;
        const data = loginAttempts.get(ip) || { attempts: 0, lastAttempt: 0, lockoutUntil: null };

        // Exponential backoff: 5 attempts = 15 min, 10 attempts = 1 hour
        if (data.attempts >= 10) {
            data.lockoutUntil = Date.now() + (60 * 60 * 1000); // 1 hour
        } else if (data.attempts >= 5) {
            data.lockoutUntil = Date.now() + (15 * 60 * 1000); // 15 minutes
        }

        loginAttempts.set(ip, data);

        const lockoutMinutes = data.lockoutUntil ? Math.ceil((data.lockoutUntil - Date.now()) / 60000) : 15;
        res.status(429).json({
            error: 'Too many failed login attempts. Account temporarily locked.',
            lockoutUntil: data.lockoutUntil,
            lockoutMinutes
        });
    }
});

// Track login attempts
const trackLoginAttempt = (req, success) => {
    const ip = req.ip;
    const data = loginAttempts.get(ip) || { attempts: 0, lastAttempt: 0, lockoutUntil: null };

    if (success) {
        // Reset on successful login
        loginAttempts.set(ip, { attempts: 0, lastAttempt: 0, lockoutUntil: null });
    } else {
        data.attempts++;
        data.lastAttempt = Date.now();
        loginAttempts.set(ip, data);
    }
};

// Session binding: track valid sessions by user ID
const validSessions = new Map(); // userId -> { ip, userAgent, createdAt }

const bindSession = (userId, ip, userAgent) => {
    validSessions.set(userId, {
        ip,
        userAgent,
        createdAt: Date.now()
    });
};

const validateSession = (userId, ip, userAgent) => {
    const session = validSessions.get(userId);
    if (!session) return false;

    // Validate IP and user agent match
    if (session.ip !== ip || session.userAgent !== userAgent) {
        console.error(`Session validation failed for user ${userId}: IP or User-Agent mismatch`);
        validSessions.delete(userId);
        return false;
    }

    // Session expires after 24 hours
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        validSessions.delete(userId);
        return false;
    }

    return true;
};

// Database Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Helper to fetch data from external API
async function fetchExternalData(uid) {
    try {
        const res = await axios.get(`https://pk.fffinfo.tsunstudio.pw/get?uid=${uid}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });
        const data = res.data;
        if (data && data.AccountInfo) {
            const info = data.AccountInfo;
            return {
                uid,
                name: info.AccountName,
                level: info.AccountLevel,
                exp: info.AccountEXP,
                region: info.AccountRegion,
                likes: info.AccountLikes,
                last_update: new Date().toLocaleTimeString()
            };
        }
    } catch (e) {
        if (e.response && e.response.status === 404) {
            console.warn(`UID ${uid} not found (404). Marking as checked.`);
            // Update last_fetched even on 404 to avoid immediate retry
            await pool.query('UPDATE players SET last_fetched = CURRENT_TIMESTAMP WHERE uid = $1', [uid]);
        } else {
            console.error(`Error fetching UID ${uid}:`, e.message);
        }
    }
    return null;
}

// Update player in database
async function updatePlayerInDb(playerData) {
    if (!playerData) return;
    const query = `
        INSERT INTO players (uid, name, level, exp, region, likes, last_update, last_fetched)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (uid) DO UPDATE SET
            name = EXCLUDED.name,
            level = EXCLUDED.level,
            exp = EXCLUDED.exp,
            region = EXCLUDED.region,
            likes = EXCLUDED.likes,
            last_update = EXCLUDED.last_update,
            last_fetched = CURRENT_TIMESTAMP;
    `;
    const values = [
        playerData.uid,
        playerData.name,
        playerData.level,
        playerData.exp,
        playerData.region,
        playerData.likes,
        playerData.last_update
    ];
    await pool.query(query, values);
}

// API Endpoints
// Public routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Protected routes
app.get('/app', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/players', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM players ORDER BY level DESC');
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/cron', authenticateToken, async (req, res) => {
    console.log('Cron trigger received...');
    try {
        const result = await pool.query('SELECT uid FROM players');
        const uids = result.rows.map(r => r.uid);

        for (let i = 0; i < uids.length; i += 5) {
            const chunk = uids.slice(i, i + 5);
            await Promise.all(chunk.map(async (uid) => {
                const data = await fetchExternalData(uid);
                await updatePlayerInDb(data);
            }));
        }
        res.json({ message: 'Cron sync completed' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sync', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT uid FROM players');
        const uids = result.rows.map(r => r.uid);

        // Sync in chunks
        for (let i = 0; i < uids.length; i += 5) {
            const chunk = uids.slice(i, i + 5);
            await Promise.all(chunk.map(async (uid) => {
                const data = await fetchExternalData(uid);
                await updatePlayerInDb(data);
            }));
        }
        res.json({ message: 'Sync completed' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sync/:uid', authenticateToken, async (req, res) => {
    const { uid } = req.params;
    try {
        const data = await fetchExternalData(uid);
        if (data) {
            await updatePlayerInDb(data);
            res.json({ message: `Sync completed for ${uid}`, data });
        } else {
            res.status(404).json({ error: 'Player not found in external API' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/adminaddplayers', authenticateToken, async (req, res) => {
    const { uids, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const uidList = Array.isArray(uids) ? uids : [uids];
        for (const uid of uidList) {
            const data = await fetchExternalData(uid);
            if (data) {
                await updatePlayerInDb({ ...data, is_admin_added: true });
            } else {
                // If not found in API, still add UID to DB so it can be tracked later
                await pool.query('INSERT INTO players (uid, is_admin_added) VALUES ($1, $2) ON CONFLICT (uid) DO NOTHING', [uid, true]);
            }
        }
        res.json({ message: 'Players added to database' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/deleteplayers', authenticateToken, async (req, res) => {
    const { uid, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        await pool.query('DELETE FROM players WHERE uid = $1', [uid]);
        res.json({ message: `Player ${uid} deleted from database` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Authentication Endpoints

// Setup endpoint - create initial admin user (one-time use)
app.post('/api/setup', async (req, res) => {
    const { username, password } = req.body;

    // Check if any users already exist
    const existingUsers = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(existingUsers.rows[0].count) > 0) {
        return res.status(403).json({ error: 'Setup already completed. Use login instead.' });
    }

    // Validate password strength
    if (password.length < 12) {
        return res.status(400).json({ error: 'Password must be at least 12 characters long.' });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
        return res.status(400).json({ error: 'Password must contain both uppercase and lowercase letters.' });
    }
    if (!/[0-9]/.test(password)) {
        return res.status(400).json({ error: 'Password must contain at least one number.' });
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        return res.status(400).json({ error: 'Password must contain at least one special character.' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
            [username, passwordHash]
        );
        res.json({ message: 'Admin user created successfully. You can now login.' });
    } catch (e) {
        if (e.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Username already exists.' });
        }
        res.status(500).json({ error: e.message });
    }
});

// Login endpoint
app.post('/api/login', loginRateLimiter, async (req, res) => {
    const { username, password } = req.body;

    // Check if locked out
    const ip = req.ip;
    const data = loginAttempts.get(ip);
    if (data && data.lockoutUntil && Date.now() < data.lockoutUntil) {
        const lockoutMinutes = Math.ceil((data.lockoutUntil - Date.now()) / 60000);
        return res.status(429).json({
            error: 'Account is temporarily locked due to too many failed attempts.',
            lockoutUntil: data.lockoutUntil,
            lockoutMinutes
        });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            trackLoginAttempt(req, false);
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            trackLoginAttempt(req, false);
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Bind session to IP and user agent
        bindSession(user.id, ip, req.get('user-agent'));

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        trackLoginAttempt(req, true);
        res.json({ message: 'Login successful', username: user.username });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            validSessions.delete(decoded.id);
        } catch (e) {
            // Token invalid/expired, just clear cookie
        }
    }
    res.clearCookie('token');
    res.json({ message: 'Logout successful' });
});

// Verify authentication status
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ authenticated: true, user: { username: req.user.username } });
});

// Background Sync Job (Every 10 minutes)
cron.schedule('*/10 * * * *', async () => {
    console.log('Running background sync...');
    try {
        const result = await pool.query('SELECT uid FROM players');
        const uids = result.rows.map(r => r.uid);
        for (let i = 0; i < uids.length; i += 5) {
            const chunk = uids.slice(i, i + 5);
            await Promise.all(chunk.map(async (uid) => {
                const data = await fetchExternalData(uid);
                await updatePlayerInDb(data);
            }));
        }
        console.log('Background sync completed.');
    } catch (e) {
        console.error('Background sync error:', e.message);
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

module.exports = app;
