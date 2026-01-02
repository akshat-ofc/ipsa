/**
 * IPSA To-Do List Application
 * Completely rewritten for stability and features.
 * Version: 11.0
 */

// --- 1. Global State & Configuration ---
let currentUser = null;
let tasks = [];

// Sound Effects
const audio = {
    pop: new Audio('pop.mp3'),
    streak: new Audio('streak.mp3'),
    complete: new Audio('strikethrough.mp3')
};

// Helper to access Supabase client safely
function getDB() {
    if (window.sb) return window.sb;
    console.error("Supabase client (window.sb) is not initialized.");
    return null;
}

// --- 2. Utilities ---

// Toast Notification System
function showToast(message, type = 'info') {
    // Remove existing toasts to prevent stacking
    const existingToasts = document.querySelectorAll('.toast');
    existingToasts.forEach(toast => toast.remove());
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-content">
            <ion-icon name="${type === 'success' ? 'checkmark-circle' : type === 'error' ? 'alert-circle' : 'information-circle'}"></ion-icon>
            <span>${message}</span>
        </div>
    `;
    
    const container = document.getElementById('toast-container') || document.body;
    container.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    // Remove after delay
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Theme Management
function initTheme() {
    try {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);
    } catch (e) {
        console.warn('Theme initialization failed:', e);
    }
}

function toggleTheme() {
    try {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
        
        showToast(`Switched to ${newTheme} mode`, 'success');
    } catch (e) {
        console.warn('Theme toggle failed:', e);
    }
}

function updateThemeIcon(theme) {
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        const icon = toggleBtn.querySelector('ion-icon');
        if (icon) icon.name = theme === 'dark' ? 'sunny' : 'moon';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Screen Navigation
function switchScreen(screenName) {
    const screens = {
        loader: document.getElementById('loader'),
        auth: document.getElementById('auth-screen'),
        profile: document.getElementById('profile-screen'),
        dashboard: document.getElementById('dashboard-screen')
    };

    // Hide all
    Object.values(screens).forEach(screen => {
        if (screen) {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        }
    });
    
    // Show target
    const targetScreen = screens[screenName];
    if (targetScreen) {
        targetScreen.classList.remove('hidden');
        targetScreen.classList.add('active');
    }
}

// Helper to trigger completion effects
function triggerCompletionEffects() {
    // Confetti
    if (window.confetti) {
        window.confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#6c5ce7', '#00b894', '#fdcb6e', '#ff7675']
        });
    }

    // Sound
    try { audio.streak.play(); } catch(e) {}

    // Toast after 1 second
    setTimeout(() => {
        showToast('All tasks completed!', 'success');
    }, 1000);
}

// Auto Cleanup at Midnight
let lastDate = new Date().toDateString();

function setupAutoCleanup() {
    // Check every 10 seconds for day change
    setInterval(() => {
        const currentDate = new Date().toDateString();
        if (currentDate !== lastDate) {
            // Day changed!
            lastDate = currentDate;
            deleteCompletedTasks();
        }
    }, 10000);
}

async function deleteCompletedTasks() {
    const completedTasks = tasks.filter(t => t.is_completed);
    if (completedTasks.length === 0) return;

    // 1. Update Local State
    tasks = tasks.filter(t => !t.is_completed);
    renderTasks();
    updateStats();

    // 2. Update DB
    const db = getDB();
    if (db) {
         const { error } = await db.from('tasks').delete().eq('is_completed', true);
         if (error) {
             console.error("Auto-cleanup error:", error);
         } else {
             showToast("New day! Completed tasks cleared.", "info");
         }
    }
}

// --- 3. Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    setupAutoCleanup();
    
    const db = getDB();
    if (!db) {
        console.error("Supabase not initialized. Check internet connection.");
        const authScreen = document.getElementById('auth-screen');
        if (authScreen) {
            authScreen.classList.remove('hidden');
            authScreen.classList.add('active');
            const authMessage = document.getElementById('auth-message');
            if (authMessage) {
                authMessage.textContent = "Connection failed. Please check your internet.";
                authMessage.classList.add('error');
            }
        }
        const loader = document.getElementById('loader');
        if (loader) {
            loader.classList.remove('active');
            loader.classList.add('hidden');
        }
        return;
    }

    // Check Active Session
    try {
        const { data: { session } } = await db.auth.getSession();
        handleSession(session);

        // Auth State Listener
        db.auth.onAuthStateChange((_event, session) => {
            handleSession(session);
        });
    } catch (err) {
        console.error("Session check failed:", err);
        switchScreen('auth');
    }

    setupEventListeners();
});

// --- 4. Authentication Logic ---

async function handleSession(session) {
    if (session) {
        currentUser = session.user;
        const profile = await loadProfile(currentUser.id);
        
        if (profile) {
            updateDashboardUI(profile);
            loadTasks();
            switchScreen('dashboard');
        } else {
            // New user or incomplete profile
            switchScreen('profile');
        }
    } else {
        currentUser = null;
        tasks = [];
        switchScreen('auth');
    }
}

async function handleLogin(email, password) {
    const db = getDB();
    if (!db) return;

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    
    if (error) {
        console.error('Login error:', error);
        showToast(error.message, 'error');
    } else {
        showToast('Welcome back!', 'success');
    }
}

async function handleSignup(email, password) {
    const db = getDB();
    if (!db) return;

    const { data, error } = await db.auth.signUp({ email, password });
    
    if (error) {
        console.error('Signup error:', error);
        showToast(error.message, 'error');
    } else {
        // Create profile immediately after signup
        if (data && data.user) {
            const firstName = email.split('@')[0];
            const { error: profileError } = await db.from('profiles').insert({
                id: data.user.id,
                first_name: firstName,
                last_name: '' // Placeholder
            });
            
            if (profileError) {
                console.error('Profile creation error:', profileError);
                // If profile creation fails, we might still want to proceed or retry
            }
        }
        showToast('Account created! Please check your email.', 'success');
    }
}

async function handleLogout() {
    const db = getDB();
    if (!db) return;

    const { error } = await db.auth.signOut();
    
    if (error) {
        console.error('Logout error:', error);
        showToast('Failed to logout', 'error');
    } else {
        showToast('Logged out successfully', 'success');
        currentUser = null;
        tasks = [];
        switchScreen('auth');
    }
}

// --- 5. Profile Logic ---

async function loadProfile(userId) {
    const db = getDB();
    if (!db) return null;

    // Fetch columns that actually exist
    const { data, error } = await db.from('profiles')
        .select('first_name, last_name, dob, gender, location')
        .eq('id', userId)
        .single();
    
    if (error) {
        console.error('Error loading profile:', error);
        return null;
    }
    return data;
}

async function updateProfile(profileData) {
    const db = getDB();
    if (!db || !currentUser) return;

    const { error } = await db.from('profiles').update({
        first_name: profileData.firstName,
        last_name: profileData.lastName,
        dob: profileData.dob,
        gender: profileData.gender,
        location: profileData.location
    }).eq('id', currentUser.id);
    
    if (error) {
        console.error('Profile update error:', error);
        showToast('Failed to update profile', 'error');
    } else {
        showToast('Profile updated!', 'success');
        // Refresh dashboard with new data
        updateDashboardUI({ 
            first_name: profileData.firstName, 
            last_name: profileData.lastName,
            location: profileData.location
        });
        switchScreen('dashboard');
    }
}

function updateDashboardUI(profile) {
    const navName = document.getElementById('nav-name');
    const navLocation = document.getElementById('nav-location');
    const navAvatar = document.getElementById('nav-avatar');
    const greetingText = document.getElementById('greeting-text');
    const dateDisplay = document.getElementById('date-display');
    
    const firstName = profile.first_name || 'User';
    const lastName = profile.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const location = profile.location || 'Unknown Location';

    if (navName) navName.textContent = firstName;
    if (navLocation) navLocation.textContent = location;
    if (greetingText) greetingText.textContent = `Hello, ${firstName}`;
    
    if (navAvatar) {
        navAvatar.textContent = firstName.charAt(0).toUpperCase() || '?';
    }
    
    if (dateDisplay) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateDisplay.textContent = new Date().toLocaleDateString(undefined, options);
    }

    // Populate profile form if it exists (for editing)
    const pFirstName = document.getElementById('first-name');
    const pLastName = document.getElementById('last-name');
    const pLocation = document.getElementById('location');
    const pDob = document.getElementById('dob');
    
    if (pFirstName && profile.first_name) pFirstName.value = profile.first_name;
    if (pLastName && profile.last_name) pLastName.value = profile.last_name;
    if (pLocation && profile.location) pLocation.value = profile.location;
    if (pDob && profile.dob) pDob.value = profile.dob;
    
    // Gender radio
    if (profile.gender) {
        const radio = document.querySelector(`input[name="gender"][value="${profile.gender}"]`);
        if (radio) radio.checked = true;
    }
}

// --- 6. Task Logic ---

async function loadTasks() {
    const db = getDB();
    if (!db || !currentUser) return;

    const { data, error } = await db.from('tasks')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error('Error loading tasks:', error);
        return;
    }
    
    tasks = data || [];
    renderTasks();
    updateStats();
}

async function addTask(title, time) {
    if (!title.trim() || !currentUser) return;
    
    const db = getDB();
    if (!db) return;

    // WORKAROUND: Append time to title with separator since 'due_time' column is missing
    let finalTitle = title.trim();
    if (time) {
        finalTitle = `${finalTitle}|||${time}`;
    }

    const taskData = {
        user_id: currentUser.id,
        title: finalTitle,
        is_completed: false
    };

    const { data, error } = await db.from('tasks').insert(taskData).select();
    
    if (error) {
        console.error("Error adding task:", error);
        showToast('Failed to add task', 'error');
        return;
    }
    
    // Play sound
    try { audio.pop.play(); } catch(e) {}

    // Add to local state and update UI
    if (data && data.length > 0) {
        tasks.unshift(data[0]);
        renderTasks();
        updateStats();
        
        // Clear inputs
        const input = document.getElementById('new-task-input');
        const timeInput = document.getElementById('new-task-time');
        if (input) input.value = '';
        if (timeInput) timeInput.value = '';
    }
}

async function toggleTask(id, isCompleted) {
    const db = getDB();
    if (!db) return;

    // Optimistic update
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return;

    const previousState = tasks[taskIndex].is_completed;
    tasks[taskIndex].is_completed = isCompleted;
    renderTasks();
    updateStats();

    // Play sound if completing
    if (isCompleted) {
        try { audio.complete.play(); } catch(e) {}
    }

    // Check for all completed
    const allCompleted = tasks.length > 0 && tasks.every(t => t.is_completed);
    if (allCompleted && isCompleted) {
        triggerCompletionEffects();
    }

    const { error } = await db.from('tasks').update({ is_completed: isCompleted }).eq('id', id);
    
    if (error) {
        console.error('Error toggling task:', error);
        // Revert on error
        tasks[taskIndex].is_completed = previousState;
        renderTasks();
        updateStats();
        showToast('Failed to update task', 'error');
    }
}

async function deleteTask(id) {
    const db = getDB();
    if (!db) return;

    // Optimistic update
    const taskToDelete = tasks.find(t => t.id === id);
    tasks = tasks.filter(t => t.id !== id);
    renderTasks();
    updateStats();

    const { error } = await db.from('tasks').delete().eq('id', id);
    
    if (error) {
        console.error('Error deleting task:', error);
        // Revert (add back)
        if (taskToDelete) tasks.push(taskToDelete);
        loadTasks(); // Reload to be safe
        showToast('Failed to delete task', 'error');
    }
}

function renderTasks(filter = 'all') {
    const list = document.getElementById('task-list');
    const empty = document.getElementById('empty-state');
    
    if (!list || !empty) return;

    const filtered = tasks.filter(t => {
        if (filter === 'active') return !t.is_completed;
        if (filter === 'completed') return t.is_completed;
        return true; // 'all' view
    });

    list.innerHTML = '';
    
    if (filtered.length === 0) {
        empty.classList.remove('hidden');
    } else {
        empty.classList.add('hidden');
        filtered.forEach(task => {
            const li = document.createElement('li');
            li.className = `task-item ${task.is_completed ? 'completed' : ''}`;
            
            // Parse title and time
            let displayTitle = task.title;
            let displayTime = null;
            
            if (task.title && task.title.includes('|||')) {
                const parts = task.title.split('|||');
                displayTitle = parts[0];
                displayTime = parts[1];
            }

            // Convert 24h to 12h
            if (displayTime) {
                try {
                    const [hours, minutes] = displayTime.split(':');
                    let h = parseInt(hours, 10);
                    const suffix = h >= 12 ? 'p.m.' : 'a.m.';
                    h = h % 12 || 12;
                    displayTime = `${h}:${minutes} ${suffix}`;
                } catch (e) {
                    console.error('Time formatting error', e);
                }
            }
            
            // Format time if exists
            const timeHtml = displayTime 
                ? `<span class="task-time-badge"><ion-icon name="time-outline"></ion-icon> ${displayTime}</span>` 
                : '';

            li.innerHTML = `
                <div class="custom-checkbox ${task.is_completed ? 'checked' : ''}" onclick="window.handleToggle('${task.id}', ${!task.is_completed})">
                    ${task.is_completed ? '<ion-icon name="checkmark-outline"></ion-icon>' : ''}
                </div>
                <div class="task-content">
                    <div class="task-header">
                        <span class="task-title">${escapeHtml(displayTitle)}</span>
                    </div>
                    <div class="task-meta">
                        ${timeHtml}
                        <span class="task-date">${new Date(task.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
                <button class="delete-btn" onclick="window.handleDelete('${task.id}')">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            `;
            list.appendChild(li);
        });
    }
}

function updateStats() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.is_completed).length;
    const active = total - completed;
    
    const totalTasksEl = document.getElementById('total-tasks');
    const completedTasksEl = document.getElementById('completed-tasks');
    const activeTasksEl = document.getElementById('active-tasks');
    const progressBar = document.getElementById('progress-bar');
    const streakEl = document.getElementById('stat-streak');
    const statTotalEl = document.getElementById('stat-total');
    const statRateEl = document.getElementById('stat-rate');

    if (totalTasksEl) totalTasksEl.textContent = total;
    if (completedTasksEl) completedTasksEl.textContent = completed;
    if (activeTasksEl) activeTasksEl.textContent = active;
    
    if (progressBar) {
        const progressPercent = total > 0 ? (completed / total) * 100 : 0;
        progressBar.style.width = `${progressPercent}%`;
    }

    // Stats View
    if (statTotalEl) statTotalEl.textContent = completed;
    if (statRateEl) {
        const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
        statRateEl.textContent = `${rate}%`;
    }
    
    // Simple Streak Logic
    if (streakEl) {
        const today = new Date().toDateString();
        const hasCompletedToday = tasks.some(t => t.is_completed && new Date(t.created_at).toDateString() === today);
        streakEl.textContent = hasCompletedToday ? "1 Day" : "0 Days";
    }
}

// --- 7. Event Listeners ---

function setupEventListeners() {
    // 1. Auth Forms
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email')?.value || '';
            const password = document.getElementById('login-password')?.value || '';
            await handleLogin(email, password);
        });
    }
    
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('signup-email')?.value || '';
            const password = document.getElementById('signup-password')?.value || '';
            await handleSignup(email, password);
        });
    }

    // 2. Auth Tabs
    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    
    if (loginTab && signupTab && loginForm && signupForm) {
        loginTab.addEventListener('click', () => {
            loginTab.classList.add('active');
            signupTab.classList.remove('active');
            
            loginForm.classList.add('active');
            loginForm.classList.remove('hidden');
            
            signupForm.classList.remove('active');
            signupForm.classList.add('hidden');
        });
        
        signupTab.addEventListener('click', () => {
            signupTab.classList.add('active');
            loginTab.classList.remove('active');
            
            signupForm.classList.add('active');
            signupForm.classList.remove('hidden');
            
            loginForm.classList.remove('active');
            loginForm.classList.add('hidden');
        });
    }

    // 3. Profile Form
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const firstName = document.getElementById('first-name')?.value || '';
            const lastName = document.getElementById('last-name')?.value || '';
            const dob = document.getElementById('dob')?.value || null;
            const location = document.getElementById('location')?.value || '';
            const genderEl = document.querySelector('input[name="gender"]:checked');
            const gender = genderEl ? genderEl.value : null;

            await updateProfile({ firstName, lastName, dob, location, gender });
        });
    }

    // 4. Task Input
    const addTaskBtn = document.getElementById('add-task-btn');
    const newTaskInput = document.getElementById('new-task-input');
    
    if (addTaskBtn && newTaskInput) {
        addTaskBtn.addEventListener('click', () => {
            const timeInput = document.getElementById('new-task-time');
            addTask(newTaskInput.value, timeInput ? timeInput.value : null);
        });

        newTaskInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const timeInput = document.getElementById('new-task-time');
                addTask(newTaskInput.value, timeInput ? timeInput.value : null);
            }
        });
    }

    // 5. Filter Chips
    const filterChips = document.querySelectorAll('.filter-chip');
    if (filterChips.length > 0) {
        filterChips.forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                renderTasks(chip.dataset.filter);
            });
        });
    }

    // 6. Navigation
    const navLinks = document.querySelectorAll('.nav-links li[data-view]');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            // Update active link
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Switch View
            const viewName = link.dataset.view;
            document.querySelectorAll('.view').forEach(v => {
                v.classList.remove('active');
                v.classList.add('hidden');
            });
            const targetView = document.getElementById(`view-${viewName}`);
            if (targetView) {
                targetView.classList.remove('hidden');
                targetView.classList.add('active');
            }
        });
    });

    // 7. Global Buttons
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}

// --- 8. Global Handlers (for onclick attributes) ---
window.handleToggle = (id, status) => toggleTask(id, status);
window.handleDelete = (id) => deleteTask(id);
