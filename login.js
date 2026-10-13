const API_BASE = '/api';

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    console.log('Login page loaded');

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
        console.log('Login form listener attached');
    } else {
        console.error('Login form not found');
    }

    // Setup button
    const setupBtnLink = document.getElementById('setupBtnLink');
    if (setupBtnLink) {
        setupBtnLink.addEventListener('click', showSetup);
        console.log('Setup button listener attached');
    } else {
        console.error('Setup button not found');
    }

    // Setup form
    const setupForm = document.getElementById('setupForm');
    if (setupForm) {
        setupForm.addEventListener('submit', handleSetup);
        console.log('Setup form listener attached');
    } else {
        console.error('Setup form not found');
    }

    // Cancel setup button
    const cancelSetupBtn = document.getElementById('cancelSetupBtn');
    if (cancelSetupBtn) {
        cancelSetupBtn.addEventListener('click', hideSetup);
        console.log('Cancel setup button listener attached');
    } else {
        console.error('Cancel setup button not found');
    }
});

async function handleLogin(event) {
    event.preventDefault();
    console.log('Login attempt...');

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const btnText = document.getElementById('btnText');
    const btnSpinner = document.getElementById('btnSpinner');
    const errorContainer = document.getElementById('errorContainer');
    const lockoutContainer = document.getElementById('lockoutContainer');

    // Clear previous messages
    errorContainer.classList.add('hidden');
    lockoutContainer.classList.add('hidden');

    // Show loading state
    loginBtn.disabled = true;
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');

    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        });

        const data = await res.json();
        console.log('Login response:', data);

        if (res.ok) {
            // Login successful, redirect to app
            window.location.href = '/app';
        } else {
            // Show error
            if (data.lockout) {
                lockoutContainer.innerHTML = `<div class="lockout-timer"><i class="fas fa-lock mr-2"></i>${data.error}<br><small>Locked for ${data.lockoutMinutes} minutes</small></div>`;
                lockoutContainer.classList.remove('hidden');
                startLockoutTimer(data.lockoutUntil);
            } else {
                errorContainer.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle mr-2"></i>${data.error}</div>`;
                errorContainer.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error('Login error:', e);
        errorContainer.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle mr-2"></i>Connection error. Please try again.</div>`;
        errorContainer.classList.remove('hidden');
    } finally {
        loginBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnSpinner.classList.add('hidden');
    }
}

function startLockoutTimer(lockoutUntil) {
    const lockoutContainer = document.getElementById('lockoutContainer');
    const interval = setInterval(() => {
        const now = Date.now();
        const remaining = lockoutUntil - now;

        if (remaining <= 0) {
            clearInterval(interval);
            lockoutContainer.classList.add('hidden');
            return;
        }

        const minutes = Math.ceil(remaining / 60000);
        lockoutContainer.innerHTML = `<div class="lockout-timer"><i class="fas fa-lock mr-2"></i>Account temporarily locked<br><small>Try again in ${minutes} minute${minutes > 1 ? 's' : ''}</small></div>`;
    }, 1000);
}

function showSetup() {
    console.log('Opening setup modal...');
    const modal = document.getElementById('setupModal');
    if (modal) {
        modal.classList.remove('hidden');
        console.log('Setup modal opened');
    } else {
        console.error('Setup modal not found');
    }
}

function hideSetup() {
    const modal = document.getElementById('setupModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    const setupForm = document.getElementById('setupForm');
    if (setupForm) {
        setupForm.reset();
    }
    const errorContainer = document.getElementById('setupErrorContainer');
    if (errorContainer) {
        errorContainer.classList.add('hidden');
    }
}

async function handleSetup(event) {
    event.preventDefault();
    console.log('Setup attempt...');

    const username = document.getElementById('setupUsername').value;
    const password = document.getElementById('setupPassword').value;
    const confirmPassword = document.getElementById('setupConfirmPassword').value;
    const setupSubmitBtn = document.getElementById('setupSubmitBtn');
    const errorContainer = document.getElementById('setupErrorContainer');

    if (password !== confirmPassword) {
        errorContainer.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle mr-2"></i>Passwords do not match</div>`;
        errorContainer.classList.remove('hidden');
        return;
    }

    setupSubmitBtn.disabled = true;
    setupSubmitBtn.innerHTML = '<span class="spinner"></span> Creating...';

    try {
        const res = await fetch(`${API_BASE}/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        console.log('Setup response:', data);

        if (res.ok) {
            alert('Admin account created successfully! You can now login.');
            hideSetup();
        } else {
            errorContainer.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle mr-2"></i>${data.error}</div>`;
            errorContainer.classList.remove('hidden');
        }
    } catch (e) {
        console.error('Setup error:', e);
        errorContainer.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle mr-2"></i>Connection error: ${e.message}</div>`;
        errorContainer.classList.remove('hidden');
    } finally {
        setupSubmitBtn.disabled = false;
        setupSubmitBtn.innerHTML = 'Create Account';
    }
}
