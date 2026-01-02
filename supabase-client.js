
// Supabase Configuration
const SUPABASE_URL = 'https://xusuhuklvttnnxwmbvos.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1c3VodWtsdnR0bm54d21idm9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODE3NTgsImV4cCI6MjA4Mjg1Nzc1OH0.rwRH0Rs0Ngv8Oxhh0RPRoiGmBV0kd5MeJJ7CysmIHCg';

// Initialize Supabase Client
// We use 'window.sb' to avoid conflict with the library's 'window.supabase'
window.sb = null;

if (window.supabase && window.supabase.createClient) {
    try {
        // Check for storage availability to prevent crashes in privacy mode
        const isStorageAvailable = () => {
            try {
                const x = '__storage_test__';
                localStorage.setItem(x, x);
                localStorage.removeItem(x);
                return true;
            } catch (e) {
                return false;
            }
        };

        // Custom Cookie Storage Adapter as fallback
        const CookieStorage = {
            getItem: (key) => {
                const name = key + "=";
                const decodedCookie = decodeURIComponent(document.cookie);
                const ca = decodedCookie.split(';');
                for(let i = 0; i < ca.length; i++) {
                    let c = ca[i];
                    while (c.charAt(0) == ' ') {
                        c = c.substring(1);
                    }
                    if (c.indexOf(name) == 0) {
                        return c.substring(name.length, c.length);
                    }
                }
                return null;
            },
            setItem: (key, value) => {
                const d = new Date();
                d.setTime(d.getTime() + (365*24*60*60*1000)); // 1 year
                const expires = "expires="+ d.toUTCString();
                // Check for size limit (approx 4kb)
                if (value.length > 3800) {
                    console.warn("Session too large for cookie storage");
                }
                document.cookie = key + "=" + value + ";" + expires + ";path=/;SameSite=Lax";
            },
            removeItem: (key) => {
                document.cookie = key + "=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;";
            }
        };

        let clientOptions = {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        };

        if (!isStorageAvailable()) {
            console.warn("Local storage blocked. Attempting to use cookies for persistence.");
            clientOptions.auth.storage = CookieStorage;
        }

        window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, clientOptions);
        console.log("Supabase client initialized as window.sb");
    } catch (err) {
        console.error("Failed to initialize Supabase:", err);
    }
} else {
    console.error("Supabase JS library not loaded!");
}
