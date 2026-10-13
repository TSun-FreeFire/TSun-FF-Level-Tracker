#!/usr/bin/env node

/**
 * Generate secure random secrets for JWT and SESSION
 * Run this script to generate strong secrets for your .env file
 */

const crypto = require('crypto');

console.log('\n=== TSun Level Tracker - Secure Secret Generator ===\n');

// Generate JWT_SECRET (32 bytes = 64 hex characters)
const jwtSecret = crypto.randomBytes(32).toString('hex');

// Generate SESSION_SECRET (32 bytes = 64 hex characters)
const sessionSecret = crypto.randomBytes(32).toString('hex');

console.log('Add these to your .env file:\n');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`SESSION_SECRET=${sessionSecret}`);
console.log('\n⚠️  IMPORTANT:');
console.log('- Keep these secrets private and never commit to git');
console.log('- Use different secrets for development and production');
console.log('- Rotate secrets periodically (every 90 days recommended)');
console.log('- If secrets are compromised, regenerate immediately\n');
