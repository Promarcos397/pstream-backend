import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('[DB] ⚠️ SUPABASE_URL and SUPABASE_ANON_KEY not set.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function getProfile(publicKey) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('public_key', publicKey)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[DB] Error getting profile:', error);
    return null;
  }
  return data;
}

export async function updateProfile(publicKey, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      public_key: publicKey,
      ...updates,
      updated_at: new Date().toISOString()
    }, { onConflict: 'public_key' })
    .select()
    .single();

  if (error) {
    console.error('[DB] Error updating profile:', error);
    throw error;
  }
  return data;
}

export async function deleteProfile(publicKey) {
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('public_key', publicKey);

  if (error) {
    console.error('[DB] Error deleting profile:', error);
    throw error;
  }
  return true;
}
