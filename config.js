// ═══════════════════════════════════════════════════════════════
//  config.js  —  PlanTrack System
//  Replace the values below with YOUR Supabase project details.
//  You can find them in: Supabase Dashboard → Project → Settings → API
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://dazvstqwxfqvhwexvlid.supabase.co';   // ← paste your Project URL
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhenZzdHF3eGZxdmh3ZXh2bGlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyOTE4OTIsImV4cCI6MjA5MDg2Nzg5Mn0.J0T7QiV8TSHjU51dvdFfbgGZEKk31Md04DXz_lOnaI8';                  // ← paste your anon/public key

// ────────────────────────────────────────────────────────────────
//  Supabase Storage bucket names (create these in your dashboard)
// ────────────────────────────────────────────────────────────────
const STORAGE_BUCKET = 'user-files';   // bucket for all uploaded files
