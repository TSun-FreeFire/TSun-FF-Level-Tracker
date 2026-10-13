require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function validatePassword(password) {
    if (password.length < 12) {
        return { valid: false, error: 'Password must be at least 12 characters long.' };
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
        return { valid: false, error: 'Password must contain both uppercase and lowercase letters.' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one number.' };
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one special character.' };
    }
    return { valid: true };
}

async function setupAdmin() {
    console.log('\n=== TSun Level Tracker - Admin Account Setup ===\n');

    try {
        // Check if users already exist
        const existingUsers = await pool.query('SELECT COUNT(*) FROM users');
        const count = parseInt(existingUsers.rows[0].count);

        if (count > 0) {
            console.log(`⚠️  Warning: ${count} user(s) already exist in the database.`);
            const proceed = await question('Do you want to continue and create another admin user? (yes/no): ');
            if (proceed.toLowerCase() !== 'yes' && proceed.toLowerCase() !== 'y') {
                console.log('Setup cancelled.');
                rl.close();
                await pool.end();
                return;
            }
        }

        // Get username
        const username = await question('Enter admin username: ');
        if (!username || username.trim().length === 0) {
            console.log('❌ Username cannot be empty.');
            rl.close();
            await pool.end();
            return;
        }

        // Get password
        const password = await question('Enter admin password: ');
        if (!password || password.length === 0) {
            console.log('❌ Password cannot be empty.');
            rl.close();
            await pool.end();
            return;
        }

        // Validate password
        const validation = validatePassword(password);
        if (!validation.valid) {
            console.log(`❌ Password validation failed: ${validation.error}`);
            rl.close();
            await pool.end();
            return;
        }

        // Confirm password
        const confirmPassword = await question('Confirm admin password: ');
        if (password !== confirmPassword) {
            console.log('❌ Passwords do not match.');
            rl.close();
            await pool.end();
            return;
        }

        // Hash password
        console.log('\n🔐 Hashing password...');
        const passwordHash = await bcrypt.hash(password, 12);

        // Insert user
        console.log('📝 Creating admin user...');
        try {
            await pool.query(
                'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
                [username.trim(), passwordHash]
            );
            console.log('✅ Admin user created successfully!');
            console.log(`\nUsername: ${username.trim()}`);
            console.log('You can now login at: http://localhost:3000\n');
        } catch (e) {
            if (e.code === '23505') {
                console.log('❌ Error: Username already exists.');
            } else {
                console.log('❌ Error creating user:', e.message);
            }
        }

    } catch (e) {
        console.log('❌ Setup failed:', e.message);
    } finally {
        rl.close();
        await pool.end();
    }
}

setupAdmin();
