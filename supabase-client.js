
// Supabase Configuration
const SUPABASE_URL = 'https://gkdrgsusyviimejjmcbg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrZHJnc3VzeXZpaW1lamptY2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MzQxNTMsImV4cCI6MjA5NzAxMDE1M30.NxADCrJZLhkoC1KMYGrYGguULxETtIto1CTIQVlHuKM';

// Initialize Supabase Client (no auth session needed — anonymous mode)
window.sb = null;

if (window.supabase && window.supabase.createClient) {
    try {
        window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });
        console.log("Supabase client initialized as window.sb");
    } catch (err) {
        console.error("Failed to initialize Supabase:", err);
    }
} else {
    console.error("Supabase JS library not loaded!");
}
