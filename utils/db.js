// Database Access Layer v1.2.1
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
// Server-side MUST use the service role key (not the anon key).
// The service role key bypasses Row Level Security and is safe for trusted server environments.
// Get it from: Supabase Dashboard → Settings → API → service_role
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('[DB] ⚠️ SUPABASE_URL and SUPABASE_SERVICE_KEY not set. Profile sync will be unavailable.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Map database snake_case to frontend camelCase
const mapToFrontend = (dbProfile) => {
  if (!dbProfile) return null;
  const { video_states, episode_progress, liked_movies, display_name, ...rest } = dbProfile;
  return {
    ...rest,
    videoStates: video_states,
    episodeProgress: episode_progress,
    likedMovies: liked_movies,
    displayName: display_name,
  };
};

// Map frontend camelCase to database snake_case
const mapToDatabase = (frontendUpdates) => {
  if (!frontendUpdates) return {};
  const { videoStates, episodeProgress, likedMovies, displayName, ...rest } = frontendUpdates;
  const dbUpdates = { ...rest };
  if (videoStates !== undefined) dbUpdates.video_states = videoStates;
  if (episodeProgress !== undefined) dbUpdates.episode_progress = episodeProgress;
  if (likedMovies !== undefined) dbUpdates.liked_movies = likedMovies;
  if (displayName !== undefined) dbUpdates.display_name = displayName;
  return dbUpdates;
};

export async function getProfile(publicKey) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('public_key', publicKey);

    if (error) {
      console.error('[DB] Profile Fetch Error:', JSON.stringify(error, null, 2));
      return null;
    }

    if (!data || data.length === 0) return null;
    return mapToFrontend(data[0]);
  } catch (err) {
    console.error('[DB] Critical Fetch Error:', err.message);
    return null;
  }
}

export async function updateProfile(publicKey, updates) {
  try {
    const dbUpdates = mapToDatabase(updates);
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        public_key: publicKey,
        ...dbUpdates,
        updated_at: new Date().toISOString()
      }, { onConflict: 'public_key' })
      .select()
      .single();

    if (error) {
      console.error('[DB] Supabase Error during updateProfile:', JSON.stringify(error, null, 2));
      throw new Error(`Profile update failed: ${error.message} (${error.code})`);
    }
    return mapToFrontend(data);
  } catch (err) {
    console.error('[DB] Critical Update Error:', err.message);
    throw err;
  }
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
