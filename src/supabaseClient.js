import { createClient } from '@supabase/supabase-js'

// Tarik data dari file .env menggunakan nama variabel yang baru
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY

// Inisialisasi koneksi
export const supabase = createClient(supabaseUrl, supabaseKey)