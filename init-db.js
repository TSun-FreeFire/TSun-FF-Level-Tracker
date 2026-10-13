require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function initDatabase() {
    console.log('\n=== TSun Level Tracker - Database Initialization ===\n');

    try {
        // Read schema.sql
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        console.log('📄 Reading schema.sql...');
        console.log('🔗 Connecting to database...');

        // Execute schema
        await pool.query(schema);

        console.log('✅ Database schema applied successfully!');
        console.log('\nTables created:');
        console.log('  - players');
        console.log('  - users');
        console.log('\nYou can now create an admin account with: node setup-admin.js\n');

    } catch (e) {
        if (e.code === '42P07') {
            console.log('⚠️  Tables already exist. No changes needed.');
        } else {
            console.error('❌ Error initializing database:', e.message);
            console.error('\nMake sure your DATABASE_URL is correct in .env file');
        }
    } finally {
        await pool.end();
    }
}

initDatabase();
