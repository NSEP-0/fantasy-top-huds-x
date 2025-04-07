/**
 * File-based State Manager for Fantasy Top Twitter Bot
 * 
 * Provides persistent state storage using local JSON files
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// Directory setup
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration with overrides from environment variables
const CONFIG = {
  stateDir: process.env.STATE_FILE_PATH ? 
    path.dirname(process.env.STATE_FILE_PATH) : 
    path.join(__dirname, './.state'),
  stateFile: process.env.STATE_FILE_PATH || 
    path.join(__dirname, './.state/state.json'),
  retentionDays: 7,
  backupsEnabled: false,
  backupDir: path.join(__dirname, './backups')
};

// Ensure state directory exists
async function ensureStateDir() {
  try {
    await fs.mkdir(CONFIG.stateDir, { recursive: true });
    
    if (CONFIG.backupsEnabled) {
      await fs.mkdir(CONFIG.backupDir, { recursive: true });
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error creating state directory:', error);
    return false;
  }
}

// Get the path to the state file for a specific key
function getStateFilePath(key) {
  // If environment variable is set directly, use it
  if (process.env.STATE_FILE_PATH) {
    return process.env.STATE_FILE_PATH;
  }
  
  // Otherwise construct path from configured state directory
  return path.join(CONFIG.stateDir, `${key}.json`);
}

/**
 * Save state to file
 * @param {string} key - The state key
 * @param {Object} data - The state data to save
 * @returns {Promise<boolean>} - Whether the save was successful
 */
export async function saveState(key, data) {
  try {
    console.log(`💾 Saving state '${key}' to file`);
    
    // Make sure directory exists
    await ensureStateDir();
    
    // Add metadata
    const stateWithMetadata = {
      ...data,
      _meta: {
        savedAt: new Date().toISOString(),
        key
      }
    };
    
    // Get the appropriate file path
    const filePath = getStateFilePath(key);
    
    // Save to file with pretty formatting
    await fs.writeFile(
      filePath,
      JSON.stringify(stateWithMetadata, null, 2),
      'utf8'
    );
    
    console.log(`✅ State '${key}' saved successfully to file`);
    return true;
  } catch (error) {
    console.error(`❌ Error saving state '${key}' to file:`, error);
    return false;
  }
}

/**
 * Load state from file
 * @param {string} key - The state key to load
 * @returns {Promise<Object|null>} - The state data or null if not found
 */
export async function loadState(key) {
  try {
    console.log(`📂 Loading state '${key}' from file`);
    
    // Get the appropriate file path
    const filePath = getStateFilePath(key);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      console.log(`⚠️ No state file found for key '${key}'`);
      return null;
    }
    
    // Read the file
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    
    // Validate date fields to detect corrupted state
    if (data.metadata && data.metadata.updatedAt) {
      const updatedAt = new Date(data.metadata.updatedAt);
      const now = new Date();
      
      // Warn if the timestamp is in the future
      if (updatedAt > now) {
        console.warn(`⚠️ State file has timestamp in the future: ${data.metadata.updatedAt}`);
      }
      
      // Warn if the timestamp is too old (more than 30 days)
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (updatedAt < thirtyDaysAgo) {
        console.warn(`⚠️ State file is very old (${data.metadata.updatedAt})`);
      }
    }
    
    console.log(`✅ Successfully loaded state '${key}' from file`);
    
    // Remove internal metadata before returning
    const { _meta, ...cleanData } = data;
    return cleanData;
  } catch (error) {
    console.error(`❌ Error loading state '${key}' from file:`, error);
    return null;
  }
}

/**
 * Delete state from file
 * @param {string} key - The state key to delete
 * @returns {Promise<boolean>} - Whether the deletion was successful
 */
export async function deleteState(key) {
  try {
    console.log(`🗑️ Deleting state '${key}' from file`);
    
    // Get the appropriate file path
    const filePath = getStateFilePath(key);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      console.log(`⚠️ No state file found for key '${key}'`);
      return true; // Consider it a success if there's nothing to delete
    }
    
    // Backup before deleting if backups are enabled
    if (CONFIG.backupsEnabled) {
      try {
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const backupPath = path.join(CONFIG.backupDir, `${key}_${timestamp}.json`);
        await fs.copyFile(filePath, backupPath);
        console.log(`📦 Created backup at ${backupPath}`);
      } catch (backupError) {
        console.error(`⚠️ Failed to create backup before deletion:`, backupError);
      }
    }
    
    // Delete the file
    await fs.unlink(filePath);
    console.log(`✅ State '${key}' deleted successfully from file`);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting state '${key}' from file:`, error);
    return false;
  }
}

console.log('🔧 File state manager configuration:', JSON.stringify({
  stateDir: CONFIG.stateDir,
  retentionDays: CONFIG.retentionDays,
  backupsEnabled: CONFIG.backupsEnabled,
  backupDir: CONFIG.backupDir
}));
