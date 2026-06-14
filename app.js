/**
 * Ipsa To-Do List Application
 * No-auth mode: anonymous persistent user via localStorage UUID.
 * Version: 12.0
 */

// --- 1. Global State & Configuration ---

// Persistent anonymous user ID — created once, stored in localStorage.
// Falls back to sessionStorage if localStorage is blocked (Tracking Prevention).
function getOrCreateUserId() {
    try {
        let uid = localStorage.getItem('ipsa_uid');
        if (!uid) {
            uid = crypto.randomUUID();
            localStorage.setItem('ipsa_uid', uid);
        }
        return uid;
    } catch (e) {
        // localStorage blocked (e.g. Edge Tracking Prevention on file://)
        console.warn('localStorage blocked, falling back to sessionStorage:', e);
        try {
            let uid = sessionStorage.getItem('ipsa_uid');
            if (!uid) {
                uid = crypto.randomUUID();
                sessionStorage.setItem('ipsa_uid', uid);
            }
            return uid;
        } catch (e2) {
            // Both blocked — generate an in-memory ID for this session
            console.warn('sessionStorage also blocked, using in-memory ID');
            return crypto.randomUUID();
        }
    }
}

const ANON_USER_ID = getOrCreateUserId();
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

    requestAnimationFrame(() => { toast.classList.add('show'); });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { toast.remove(); }, 300);
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

// Screen Navigation (no auth screen, skip straight to dashboard)
function switchScreen(screenName) {
    const screens = {
        loader: document.getElementById('loader'),
        dashboard: document.getElementById('dashboard-screen')
    };

    Object.values(screens).forEach(screen => {
        if (screen) {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        }
    });

    const targetScreen = screens[screenName];
    if (targetScreen) {
        targetScreen.classList.remove('hidden');
        targetScreen.classList.add('active');
    }
}

// Confetti / sound on all-complete
function triggerCompletionEffects() {
    if (window.confetti) {
        window.confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#6c5ce7', '#00b894', '#fdcb6e', '#ff7675']
        });
    }
    try { audio.streak.play(); } catch(e) {}
    setTimeout(() => { showToast('All tasks completed! 🎉', 'success'); }, 1000);
}

// Auto Cleanup at Midnight
let lastDate = new Date().toDateString();

function setupAutoCleanup() {
    setInterval(() => {
        const currentDate = new Date().toDateString();
        if (currentDate !== lastDate) {
            lastDate = currentDate;
            deleteCompletedTasks();
        }
    }, 10000);
}

async function deleteCompletedTasks() {
    const completedTasks = tasks.filter(t => t.is_completed);
    if (completedTasks.length === 0) return;

    tasks = tasks.filter(t => !t.is_completed);
    renderTasks();
    await updateStats();

    const db = getDB();
    if (db) {
        const { error } = await db.from('tasks')
            .delete()
            .eq('user_id', ANON_USER_ID)
            .eq('is_completed', true);
        if (error) {
            console.error("Auto-cleanup error:", error);
        } else {
            showToast("New day! Completed tasks cleared.", "info");
        }
    }
}

// --- 3. Streak Logic ---

async function loadAndUpdateStreak() {
    const db = getDB();
    if (!db) return;

    // maybeSingle() returns null (not an error) when no row exists — avoids 406
    const { data, error } = await db.from('streaks')
        .select('*')
        .eq('user_id', ANON_USER_ID)
        .maybeSingle();

    if (error) {
        if (error.code === '42P01') {
            showToast('⚠️ Database tables missing — please run the SQL setup script in Supabase.', 'error');
        } else {
            console.error('Error loading streak:', error);
        }
        return;
    }

    if (!data) {
        // First time — insert initial row
        const { error: insertErr } = await db.from('streaks').insert({
            user_id: ANON_USER_ID,
            current_streak: 0,
            longest_streak: 0,
            last_active_date: null,
            total_completed: 0
        });
        if (insertErr) {
            if (insertErr.code === '42501' || insertErr.message?.includes('401') || insertErr.status === 401) {
                showToast('⚠️ Database permission error — please run the SQL setup script in Supabase.', 'error');
            } else {
                console.error('Error creating streak row:', insertErr);
            }
        }
        return;
    }

    return data;
}

async function recordTaskCompletion() {
    const db = getDB();
    if (!db) return;

    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await db.from('streaks')
        .select('*')
        .eq('user_id', ANON_USER_ID)
        .maybeSingle();

    if (error || !data) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    let newStreak = data.current_streak;
    let streakChanged = false;

    if (data.last_active_date === today) {
        // Streak already updated today — only increment total_completed
        streakChanged = false;
    } else if (data.last_active_date === yesterdayStr) {
        // Consecutive day!
        newStreak = data.current_streak + 1;
        streakChanged = true;
    } else {
        // Streak broken or first completion
        newStreak = 1;
        streakChanged = true;
    }

    // Always increment total_completed (counts unique completions, not re-toggles)
    const totalCompleted = (data.total_completed || 0) + 1;
    const longestStreak = Math.max(data.longest_streak || 0, newStreak);

    await db.from('streaks').update({
        current_streak: newStreak,
        longest_streak: longestStreak,
        last_active_date: today,
        total_completed: totalCompleted
    }).eq('user_id', ANON_USER_ID);
}

// --- 4. Profile Logic ---

async function loadProfile() {
    const db = getDB();
    if (!db) return null;

    // maybeSingle() returns null (not an error) when no row exists — avoids 406
    // Fetch ALL profile fields so the edit modal can pre-fill dob and gender
    const { data, error } = await db.from('profiles')
        .select('first_name, last_name, location, dob, gender')
        .eq('user_id', ANON_USER_ID)
        .maybeSingle();

    if (error) {
        console.error('Error loading profile:', error);
        return null;
    }

    return data || null;
}

async function ensureProfile() {
    const db = getDB();
    if (!db) return { first_name: 'User', last_name: '', location: '' };

    const profile = await loadProfile();
    if (!profile) {
        // Create a default profile for first-time users
        const { error: insertErr } = await db.from('profiles').insert({
            user_id: ANON_USER_ID,
            first_name: 'User',
            last_name: '',
            location: ''
        });
        if (insertErr) {
            // 42501 = insufficient_privilege (RLS), 401 = unauthorized (no grants)
            if (insertErr.code === '42501' || insertErr.status === 401 || insertErr.code === '42P01') {
                showToast('⚠️ Supabase setup needed — run the SQL script in your project first.', 'error');
            } else {
                console.error('Error creating profile:', insertErr);
            }
        }
        return { first_name: 'User', last_name: '', location: '' };
    }
    return profile;
}

async function updateProfile(profileData) {
    const db = getDB();
    if (!db) return;

    const { error } = await db.from('profiles').upsert({
        user_id: ANON_USER_ID,
        first_name: profileData.firstName,
        last_name: profileData.lastName,
        location: profileData.location,
        dob: profileData.dob || null,
        gender: profileData.gender || null
    }, { onConflict: 'user_id' });

    if (error) {
        console.error('Profile update error:', error);
        showToast('Failed to update profile', 'error');
    } else {
        showToast('Profile updated!', 'success');
        updateDashboardUI(profileData.firstName, profileData.location);
        closeProfileModal();
    }
}

function updateDashboardUI(firstName, location) {
    const navName = document.getElementById('nav-name');
    const navLocation = document.getElementById('nav-location');
    const navAvatar = document.getElementById('nav-avatar');
    const greetingText = document.getElementById('greeting-text');
    const dateDisplay = document.getElementById('date-display');

    if (navName) navName.textContent = firstName || 'User';
    if (navLocation) navLocation.textContent = location || '';
    if (navAvatar) navAvatar.textContent = (firstName || 'U').charAt(0).toUpperCase();
    if (greetingText) greetingText.textContent = `Hello, ${firstName || 'User'}`;

    if (dateDisplay) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateDisplay.textContent = new Date().toLocaleDateString(undefined, options);
    }
}

function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('active');
    }
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('active');
    }
}

// --- 5. Task Logic ---

async function loadTasks() {
    const db = getDB();
    if (!db) return;

    const { data, error } = await db.from('tasks')
        .select('*')
        .eq('user_id', ANON_USER_ID)
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
    if (!title.trim()) return;

    const db = getDB();
    if (!db) return;

    const taskData = {
        user_id: ANON_USER_ID,
        title: title.trim(),
        due_time: time || null,
        is_completed: false
    };

    const { data, error } = await db.from('tasks').insert(taskData).select();

    if (error) {
        console.error("Error adding task:", error);
        showToast('Failed to add task', 'error');
        return;
    }

    try { audio.pop.play(); } catch(e) {}

    if (data && data.length > 0) {
        tasks.unshift(data[0]);
        renderTasks();
        updateStats();

        const input = document.getElementById('new-task-input');
        const timeInput = document.getElementById('new-task-time');
        if (input) input.value = '';
        if (timeInput) timeInput.value = '';
    }
}

async function toggleTask(id, isCompleted) {
    const db = getDB();
    if (!db) return;

    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return;

    const previousState = tasks[taskIndex].is_completed;
    tasks[taskIndex].is_completed = isCompleted;
    renderTasks();
    updateStats();

    if (isCompleted) {
        try { audio.complete.play(); } catch(e) {}
        await recordTaskCompletion();
    }

    const allCompleted = tasks.length > 0 && tasks.every(t => t.is_completed);
    if (allCompleted && isCompleted) {
        triggerCompletionEffects();
    }

    const { error } = await db.from('tasks').update({ is_completed: isCompleted }).eq('id', id);

    if (error) {
        console.error('Error toggling task:', error);
        tasks[taskIndex].is_completed = previousState;
        renderTasks();
        updateStats();
        showToast('Failed to update task', 'error');
    }
}

async function deleteTask(id) {
    const db = getDB();
    if (!db) return;

    const taskToDelete = tasks.find(t => t.id === id);
    tasks = tasks.filter(t => t.id !== id);
    renderTasks();
    updateStats();

    const { error } = await db.from('tasks').delete().eq('id', id);

    if (error) {
        console.error('Error deleting task:', error);
        if (taskToDelete) tasks.push(taskToDelete);
        loadTasks();
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
        return true;
    });

    list.innerHTML = '';

    if (filtered.length === 0) {
        empty.classList.remove('hidden');
    } else {
        empty.classList.add('hidden');
        filtered.forEach(task => {
            const li = document.createElement('li');
            li.className = `task-item ${task.is_completed ? 'completed' : ''}`;

            let displayTime = null;
            if (task.due_time) {
                try {
                    const [hours, minutes] = task.due_time.split(':');
                    let h = parseInt(hours, 10);
                    const suffix = h >= 12 ? 'p.m.' : 'a.m.';
                    h = h % 12 || 12;
                    displayTime = `${h}:${minutes} ${suffix}`;
                } catch(e) {}
            }

            const timeHtml = displayTime
                ? `<span class="task-time-badge"><ion-icon name="time-outline"></ion-icon> ${displayTime}</span>`
                : '';

            li.innerHTML = `
                <div class="custom-checkbox ${task.is_completed ? 'checked' : ''}" onclick="window.handleToggle('${task.id}', ${!task.is_completed})">
                    ${task.is_completed ? '<ion-icon name="checkmark-outline"></ion-icon>' : ''}
                </div>
                <div class="task-content">
                    <div class="task-header">
                        <span class="task-title">${escapeHtml(task.title)}</span>
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

async function updateStats(fetchStreaks = false) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.is_completed).length;
    const active = total - completed;

    const totalTasksEl = document.getElementById('total-tasks');
    const completedTasksEl = document.getElementById('completed-tasks');
    const activeTasksEl = document.getElementById('active-tasks');
    const progressBar = document.getElementById('progress-bar');
    const statTotalEl = document.getElementById('stat-total');
    const statRateEl = document.getElementById('stat-rate');

    if (totalTasksEl) totalTasksEl.textContent = total;
    if (completedTasksEl) completedTasksEl.textContent = completed;
    if (activeTasksEl) activeTasksEl.textContent = active;

    if (progressBar) {
        const pct = total > 0 ? (completed / total) * 100 : 0;
        progressBar.style.width = `${pct}%`;
    }

    if (statTotalEl) statTotalEl.textContent = completed;
    if (statRateEl) {
        const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
        statRateEl.textContent = `${rate}%`;
    }

    // Streak data is only fetched from DB when the stats view is active
    // (or explicitly requested) to avoid a DB round-trip on every task change
    if (fetchStreaks) {
        await refreshStreakDisplay();
    }
}

async function refreshStreakDisplay() {
    const db = getDB();
    if (!db) return;

    const streakEl = document.getElementById('stat-streak');
    const longestStreakEl = document.getElementById('stat-longest-streak');
    const allTimeEl = document.getElementById('stat-all-time');

    const { data } = await db.from('streaks')
        .select('current_streak, longest_streak, total_completed')
        .eq('user_id', ANON_USER_ID)
        .maybeSingle();

    if (data) {
        if (streakEl) streakEl.textContent = `${data.current_streak} Day${data.current_streak !== 1 ? 's' : ''}`;
        if (longestStreakEl) longestStreakEl.textContent = `${data.longest_streak} Day${data.longest_streak !== 1 ? 's' : ''}`;
        if (allTimeEl) allTimeEl.textContent = data.total_completed || 0;
    }
}

// --- 6. Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    setupAutoCleanup();

    // Always set up event listeners so the UI is interactive even if DB fails
    setupEventListeners();

    const db = getDB();
    if (!db) {
        console.error("Supabase not initialized. Check internet connection.");
        switchScreen('dashboard');
        showToast("Offline — data won't be saved.", 'error');
        return;
    }

    // Ensure profile + streak rows exist
    const profile = await ensureProfile();
    await loadAndUpdateStreak();

    // Populate UI
    updateDashboardUI(profile?.first_name || 'User', profile?.location || '');
    await loadTasks();

    switchScreen('dashboard');
});

// --- 7. Event Listeners ---

function setupEventListeners() {
    // Task Input
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

    // Filter Chips
    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderTasks(chip.dataset.filter);
        });
    });

    // Navigation
    const navLinks = document.querySelectorAll('.nav-links li[data-view]');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

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

            // When switching to stats view, fetch fresh streak data from DB
            if (viewName === 'stats') updateStats(true);
        });
    });

    // Theme Toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    // Profile Edit Button
    const editProfileBtn = document.getElementById('edit-profile-btn');
    if (editProfileBtn) editProfileBtn.addEventListener('click', async () => {
        const profile = await loadProfile();
        if (profile) {
            const fn = document.getElementById('edit-first-name');
            const ln = document.getElementById('edit-last-name');
            const loc = document.getElementById('edit-location');
            const dob = document.getElementById('edit-dob');
            if (fn) fn.value = profile.first_name || '';
            if (ln) ln.value = profile.last_name || '';
            if (loc) loc.value = profile.location || '';
            if (dob) dob.value = profile.dob || '';
            // Pre-check the saved gender radio
            if (profile.gender) {
                const radio = document.querySelector(`input[name="gender"][value="${profile.gender}"]`);
                if (radio) radio.checked = true;
            }
        }
        openProfileModal();
    });

    // Profile Modal Close
    const closeModalBtn = document.getElementById('close-profile-modal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeProfileModal);

    // Click outside to close
    const profileModal = document.getElementById('profile-modal');
    if (profileModal) {
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) closeProfileModal();
        });
    }

    // Profile Form Submit
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const firstName = document.getElementById('edit-first-name')?.value || 'User';
            const lastName = document.getElementById('edit-last-name')?.value || '';
            const dob = document.getElementById('edit-dob')?.value || null;
            const location = document.getElementById('edit-location')?.value || '';
            const genderEl = document.querySelector('input[name="gender"]:checked');
            const gender = genderEl ? genderEl.value : null;
            await updateProfile({ firstName, lastName, dob, location, gender });
        });
    }
}

// --- 8. Global Handlers ---
window.handleToggle = (id, status) => toggleTask(id, status);
window.handleDelete = (id) => deleteTask(id);
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
