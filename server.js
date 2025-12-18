require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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
        const res = await axios.get(`https://danger-info-alpha.vercel.app/web-info?uid=${uid}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });
        const data = res.data;
        if (data && data.status === "success" && data.data && data.data.basicInfo) {
            const basicInfo = data.data.basicInfo;
            return {
                uid,
                name: basicInfo.nickname,
                level: basicInfo.level,
                exp: basicInfo.exp,
                region: basicInfo.region,
                likes: basicInfo.liked,
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
app.get('/api/players', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM players ORDER BY level DESC');
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sync', async (req, res) => {
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

app.post('/api/sync/:uid', async (req, res) => {
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

app.post('/api/adminaddplayers', async (req, res) => {
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

app.post('/api/deleteplayers', async (req, res) => {
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
