# Security Implementation Guide

## Overview
This application now implements multi-layered security with JWT authentication, rate limiting, session binding, and Cloudflare Access integration. Only authenticated users can access the application.

## ⚠️ CRITICAL SECURITY WARNING

### The Vulnerability That Was Exploited
If JWT_SECRET is not set or is weak, anyone can forge their own JWT tokens and bypass authentication entirely. This is like leaving your front door unlocked.

**How the hack works:**
1. Without a strong JWT_SECRET, hackers can use default or predictable secrets
2. They can create their own JWT tokens using these weak secrets
3. The server accepts these forged tokens as valid
4. They gain full access to the dashboard without knowing your password

**This has been FIXED with:**
- ✅ Server now REQUIRES JWT_SECRET and SESSION_SECRET to start
- ✅ Secrets must be at least 32 characters
- ✅ Server exits with error if secrets are missing or weak
- ✅ Session binding (tokens are tied to IP and user agent)
- ✅ Database validation on every token verification

## Security Features

### Application Layer
- **JWT Authentication**: Secure token-based authentication with httpOnly cookies
- **Bcrypt Password Hashing**: Passwords are never stored in plain text
- **Login Rate Limiting**: Exponential backoff (5 attempts → 15 min lockout, 10 attempts → 1 hour lockout)
- **Session Binding**: Tokens are tied to IP address and user agent (prevents token theft)
- **Database Validation**: Every token is validated against the database
- **Security Headers**: Helmet.js with CSP, HSTS, and other security headers
- **Protected Routes**: All API endpoints require authentication
- **Startup Validation**: Server refuses to start without proper security configuration

### Network Layer (Optional - Recommended)
- **Cloudflare Access**: Zero Trust authentication with One-Time PIN
- **IP Whitelisting**: Optional IP-based access control
- **HTTPS/TLS**: SSL/TLS encryption for all traffic

## Setup Instructions

### 1. Update Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 2. Generate Secure Secrets (CRITICAL - DO NOT SKIP)

**The server will NOT start without these secrets!**

Run the provided script to generate strong secrets:

```bash
node generate-secrets.js
```

This will output:
```
JWT_SECRET=<64-character random string>
SESSION_SECRET=<64-character random string>
```

Copy these into your `.env` file.

**⚠️ NEVER:**
- Use default or weak secrets
- Share these secrets
- Commit `.env` to git
- Use the same secret for JWT_SECRET and SESSION_SECRET

**✅ ALWAYS:**
- Use the provided `generate-secrets.js` script
- Keep secrets private and secure
- Use different secrets for dev/staging/prod
- Rotate secrets every 90 days

Required variables in `.env`:
- `DATABASE_URL`: Your Neon PostgreSQL connection string
- `ADMIN_PASSWORD`: Password for admin operations (database player management)
- `JWT_SECRET`: **MUST be 32+ characters** (generated above)
- `SESSION_SECRET`: **MUST be 32+ characters** (generated above)
- `FRONTEND_URL`: Your frontend URL (e.g., http://localhost:3000)
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Set to `production` in production

### 3. Apply Database Schema

Apply the updated schema to create the users table:

```bash
# Connect to your Neon DB and run schema.sql
# Or use psql:
psql $DATABASE_URL -f schema.sql
```

### 4. Create Admin User

Run the setup script to create your admin account:

```bash
node setup-admin.js
```

Follow the prompts to create a username and strong password.

**Password Requirements:**
- Minimum 12 characters
- Uppercase and lowercase letters
- At least one number
- At least one special character (!@#$%^&*(),.?":{}|<>)

### 5. Start the Server

```bash
npm start
```

**⚠️ If the server fails to start:**
You will see an error like:
```
❌ CRITICAL SECURITY ERROR:
The following required environment variables are not set:
  - JWT_SECRET
  - SESSION_SECRET

Please set these in your .env file before starting the server.
```

This is intentional - the server will NOT start without proper security configuration. Run `node generate-secrets.js` and add the secrets to your `.env` file.

For development with auto-reload:
```bash
npm install -g nodemon
nodemon server.js
```

### 6. Test Authentication

1. Visit `http://localhost:3000` - You should see the login page
2. Enter your admin credentials
3. On successful login, you'll be redirected to `/app` (the main application)
4. Try accessing `/app` without authentication - you'll be redirected to login
5. Test rate limiting by entering wrong password 5 times - you'll see a lockout timer

## Cloudflare Access Setup (Optional but Recommended)

For maximum security, deploy behind Cloudflare Access:

### Step 1: Sign up for Cloudflare Zero Trust
1. Go to https://dash.cloudflare.com/sign-up
2. Create a free account

### Step 2: Add Your Domain
1. Add your domain to Cloudflare
2. Update your domain's nameservers to Cloudflare's nameservers

### Step 3: Configure Cloudflare Access
1. Go to Zero Trust → Access → Applications
2. Click "Add an application"
3. Configure:
   - **Application Name**: TSun Level Tracker
   - **Session Duration**: 24 hours
   - **Authentication**: One-Time PIN
   - **Policy**: Include "Everyone" (or specific email if using email auth)
4. **IP Whitelisting** (Optional):
   - Add your IP address to the policy
   - Check if your IP is static first (restart router and see if IP changes)

### Step 4: Update DNS
1. Your domain should already be pointing to Cloudflare
2. Ensure the application is accessible through Cloudflare

### Step 5: Enable HTTPS
1. In Cloudflare dashboard, go to SSL/TLS
2. Set mode to "Full (strict)" for production
3. Enable "Always Use HTTPS"

## Production Deployment Checklist

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Use strong, unique secrets for JWT_SECRET and SESSION_SECRET
- [ ] Enable HTTPS (Cloudflare provides free SSL)
- [ ] Set `FRONTEND_URL` to your production domain
- [ ] Configure Cloudflare Access with One-Time PIN
- [ ] Test authentication flow
- [ ] Test rate limiting
- [ ] Verify security headers are present
- [ ] Test admin password for database operations
- [ ] Regularly rotate JWT_SECRET and SESSION_SECRET
- [ ] Keep dependencies updated: `npm audit fix`

## Security Best Practices

### Password Security
- Use a password manager to generate and store your password
- Never share your password
- Change your password if you suspect it's compromised
- Use different passwords for different services

### Secret Management
- Never commit `.env` file to version control
- Rotate secrets periodically (every 90 days recommended)
- Use environment-specific secrets (different for dev/staging/prod)
- Consider using a secrets manager in production

### Monitoring
- Monitor failed login attempts
- Set up alerts for suspicious activity
- Review Cloudflare Access logs regularly
- Monitor application logs for security events

## Troubleshooting

### Server Won't Start
- **Error**: "CRITICAL SECURITY ERROR: JWT_SECRET not set"
- **Solution**: Run `node generate-secrets.js` and add the secrets to `.env`
- **Error**: "JWT_SECRET is too short"
- **Solution**: JWT_SECRET must be at least 32 characters. Use the generator script.

### Login Not Working
- Check that JWT_SECRET is set in `.env` (run `node generate-secrets.js` if not)
- Verify the users table exists in the database
- Check browser console for errors
- Ensure cookies are enabled in your browser
- If you just changed JWT_SECRET, clear your browser cookies and login again

### Rate Limiting Issues
- Rate limiting is stored in memory and resets on server restart
- For production, consider using Redis for distributed rate limiting
- Check the lockout timer on the login page

### Cloudflare Access Issues
- Ensure your domain is properly configured in Cloudflare
- Check that DNS is pointing to Cloudflare
- Verify Access policy is active
- Check that you're not behind a corporate firewall blocking Cloudflare

### Database Connection Issues
- Verify DATABASE_URL is correct
- Check that Neon DB is accessible
- Ensure SSL is configured correctly

## File Changes Summary

### Modified Files
- `package.json` - Added security dependencies
- `server.js` - Added authentication middleware, rate limiting, security headers, login/logout endpoints
- `schema.sql` - Added users table
- `index.html` - Added logout button and authentication check
- `.env.example` - Added new environment variables

### New Files
- `login.html` - Login page with rate limiting display
- `setup-admin.js` - Admin user creation script
- `SECURITY_SETUP.md` - This documentation

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Cloudflare Access documentation
3. Check application logs for error messages
4. Verify all environment variables are set correctly

## Security Architecture Diagram

```
User Request
    ↓
[Cloudflare Access] - Network Layer (Optional)
    ↓ (One-Time PIN / IP Whitelist)
[HTTPS/TLS] - Encryption Layer
    ↓
[Login Page] - Authentication Entry
    ↓
[Rate Limiting] - Brute Force Protection
    ↓
[JWT Authentication] - Application Layer
    ↓
[Protected Routes] - API Endpoints
    ↓
[Database] - PostgreSQL with Neon
```

Each layer provides independent protection. If one layer is compromised, other layers continue to protect the application.
