/**
 * stateManager.mjs - Enhanced state persistence with cloud-ready architecture
 * 
 * Features:
 * - Storage provider abstraction (file-based now, cloud-ready for later)
 * - Comprehensive execution metrics and statistics
 * - Built-in error tracking and recovery
 * - Enhanced metadata for better monitoring
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Configuration
const CONFIG = {
  stateDir: process.env.STATE_DIR || process.cwd(),
  stateFile: process.env.STATE_FILE || 'state.json',
  metricsFile: process.env.METRICS_FILE || 'metrics.json',
  retentionDays: process.env.STATE_RETENTION_DAYS ? parseInt(process.env.STATE_RETENTION_DAYS) : 7,
  maxStateSizeBytes: 5 * 1024 * 1024, // 5MB max state file size
  backupFrequency: 10, // Create backup every N state updates
};

// Full paths to state files
const STATE_FILE_PATH = path.join(CONFIG.stateDir, CONFIG.stateFile);
const METRICS_FILE_PATH = path.join(CONFIG.stateDir, CONFIG.metricsFile);
const BACKUP_DIR = path.join(CONFIG.stateDir, 'backups');

// State version for future compatibility
const STATE_VERSION = '1.0.0';

// Operation tracking
let updateCounter = 0;

/**
 * Initialize state directory structure
 * Ensures all required directories exist
 */
async function initStateStorage() {
  try {
    // Create state directory if it doesn't exist
    await fs.mkdir(CONFIG.stateDir, { recursive: true });
    
    // Create backups directory
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    
    console.log(`📂 Initialized state storage at ${CONFIG.stateDir}`);
  } catch (error) {
    console.error('❌ Failed to initialize state storage directories:', error);
  }
}

/**
 * Gets the default state structure
 * @returns {Object} Default state object
 */
function getDefaultState() {
  return {
    metadata: {
      version: STATE_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hostInfo: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release()
      }
    },
    twitter: {
      lastMentionId: null,
      processedCount: 0,
      lastProcessedAt: null
    },
    replies: {
      count: 0,
      byHero: {},
      history: {}
    },
    errors: {
      count: 0,
      last: null,
      history: []
    },
    executionMetrics: {
      totalRuns: 0,
      lastRunTime: null,
      lastRunDuration: 0,
      avgRunDuration: 0,
      successRate: 100
    }
  };
}

/**
 * Migrates from old state format to new format
 * @param {Object} oldState - The old state object
 * @returns {Object} - The migrated state object
 */
function migrateStateFormat(oldState) {
  console.log('🔄 Migrating state from old format to new format...');
  
  // Check if this is an old format state (has lastMentionId at the top level)
  if (oldState.lastMentionId !== undefined && !oldState.metadata) {
    console.log('📝 Old state format detected. Converting to new format.');
    
    // Start with a fresh state
    const newState = getDefaultState();
    
    // Copy the lastMentionId to the new location
    newState.twitter.lastMentionId = oldState.lastMentionId;
    
    // If there are repliedTweets, move them to the new location
    if (oldState.repliedTweets) {
      // Count how many replies we're migrating
      const replyCount = Object.keys(oldState.repliedTweets).length;
      console.log(`📊 Migrating ${replyCount} replied tweets`);
      
      // Copy the replies
      newState.replies.history = oldState.repliedTweets;
      newState.replies.count = replyCount;
      
      // Build the byHero statistics from the old data
      const byHero = {};
      for (const [tweetId, data] of Object.entries(oldState.repliedTweets)) {
        if (data.heroName) {
          const heroName = data.heroName.toLowerCase();
          byHero[heroName] = (byHero[heroName] || 0) + 1;
        }
      }
      newState.replies.byHero = byHero;
      
      console.log(`🦸 Built hero statistics for ${Object.keys(byHero).length} heroes`);
    }
    
    // Update metadata timestamps
    const oldestReply = Object.values(oldState.repliedTweets || {})
      .map(r => new Date(r.repliedAt))
      .sort((a, b) => a - b)[0];
      
    if (oldestReply) {
      newState.metadata.createdAt = oldestReply.toISOString();
    }
    
    console.log('✅ Migration completed successfully');
    return newState;
  }
  
  return oldState; // Return unchanged if it's already in the new format
}

/**
 * Create a backup of the current state
 */
async function backupState() {
  try {
    // Only backup if state file exists
    try {
      await fs.access(STATE_FILE_PATH);
    } catch (e) {
      return; // No file to backup
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `state_${timestamp}.json`);
    
    await fs.copyFile(STATE_FILE_PATH, backupPath);
    console.log(`🔄 Created state backup: ${backupPath}`);
    
    // Cleanup old backups
    const backups = await fs.readdir(BACKUP_DIR);
    if (backups.length > 10) { // Keep last 10 backups
      const sortedBackups = backups
        .filter(f => f.startsWith('state_'))
        .sort()
        .slice(0, backups.length - 10);
      
      for (const oldBackup of sortedBackups) {
        await fs.unlink(path.join(BACKUP_DIR, oldBackup));
      }
      console.log(`🧹 Cleaned up ${sortedBackups.length} old backups`);
    }
  } catch (error) {
    console.error('❌ Failed to backup state:', error);
  }
}

/**
 * Loads the application state safely
 * With error recovery and validation
 * 
 * @returns {Promise<Object>} The state object
 */
export async function loadState() {
  await initStateStorage();
  
  try {
    console.log(`📂 Loading application state from ${STATE_FILE_PATH}`);
    let state;
    
    try {
      const data = await fs.readFile(STATE_FILE_PATH, 'utf-8');
      let rawState = JSON.parse(data);
      
      // First attempt to migrate if this is an old format
      rawState = migrateStateFormat(rawState);
      
      // Validate state has expected structure
      if (!rawState.metadata || !rawState.twitter || !rawState.replies || 
          !rawState.errors || !rawState.executionMetrics) {
        console.warn('⚠️ State file has incomplete structure. Creating fresh state.');
        throw new Error('Invalid state structure');
      }
      
      // Check version compatibility
      if (rawState.metadata.version !== STATE_VERSION) {
        console.log(`🔄 State version mismatch. Migrating from ${rawState.metadata.version} to ${STATE_VERSION}`);
        // In the future, implement version migration logic here
      }
      
      // Validate and fix impossible success rate values
      if (rawState.executionMetrics && rawState.executionMetrics.successRate > 100) {
        console.warn('⚠️ Found invalid success rate > 100%. Correcting to 100%.');
        rawState.executionMetrics.successRate = 100;
      }
      
      state = rawState;
      console.log(`✅ State loaded: Found ${Object.keys(state.replies.history).length} replied tweets`);
    } catch (error) {
      if (error.code === 'ENOENT' || error.message.includes('no such file')) {
        console.log('📄 No state file found. Creating fresh state.');
      } else {
        console.error(`❌ Error loading state: ${error.message}`);
        // Try to load backup if main state file is corrupted
        try {
          const backups = await fs.readdir(BACKUP_DIR);
          if (backups.length > 0) {
            const latestBackup = backups.filter(f => f.startsWith('state_')).sort().pop();
            if (latestBackup) {
              console.log(`🔄 Attempting to restore from backup: ${latestBackup}`);
              const backupData = await fs.readFile(path.join(BACKUP_DIR, latestBackup), 'utf-8');
              state = JSON.parse(backupData);
              await saveState(state); // Restore the backup as the main state
              return state;
            }
          }
        } catch (backupError) {
          console.error('❌ Failed to restore from backup:', backupError);
        }
      }
      
      // Return default state if can't load or restore
      state = getDefaultState();
    }
    
    return state;
  } catch (error) {
    console.error('❌ Critical error in loadState:', error);
    return getDefaultState();
  }
}

/**
 * Saves the application state with atomic write pattern
 * @param {Object} state - The state object to save
 * @returns {Promise<boolean>} True if save was successful
 */
export async function saveState(state) {
  try {
    // Update metadata
    state.metadata = state.metadata || {};
    state.metadata.updatedAt = new Date().toISOString();
    state.metadata.version = STATE_VERSION;
    
    console.log(`💾 Saving application state to ${STATE_FILE_PATH}`);
    
    // Use atomic write pattern (write to temp file, then rename)
    const tempFile = `${STATE_FILE_PATH}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(state, null, 2));
    await fs.rename(tempFile, STATE_FILE_PATH);
    
    // Create periodic backups
    updateCounter++;
    if (updateCounter % CONFIG.backupFrequency === 0) {
      await backupState();
    }
    
    console.log('✅ State saved successfully');
    return true;
  } catch (error) {
    console.error('❌ Error saving state:', error);
    return false;
  }
}

/**
 * Resets the application state to default
 * @returns {Promise<boolean>} True if reset was successful
 */
export async function resetState() {
  try {
    // Backup current state before resetting
    await backupState();
    
    const freshState = getDefaultState();
    
    console.log('🧹 Resetting application state to clean slate...');
    await saveState(freshState);
    console.log('✅ Application state has been reset.');
    return true;
  } catch (error) {
    console.error('❌ Error resetting state:', error);
    return false;
  }
}

/**
 * Records the start of an execution run
 * @returns {Promise<string>} Execution ID for this run
 */
export async function startExecution() {
  try {
    const state = await loadState();
    const executionId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    state.executionMetrics = state.executionMetrics || {};
    state.executionMetrics.totalRuns = (state.executionMetrics.totalRuns || 0) + 1;
    state.executionMetrics.lastRunStart = new Date().toISOString();
    state.executionMetrics.currentExecutionId = executionId;
    
    await saveState(state);
    console.log(`🚀 Started execution: ${executionId}`);
    return executionId;
  } catch (error) {
    console.error('❌ Failed to record execution start:', error);
    return `error_run_${Date.now()}`;
  }
}

/**
 * Records the completion of an execution run
 * @param {boolean} success - Whether the execution was successful
 * @param {Object} stats - Additional statistics about the run
 * @returns {Promise<void>}
 */
export async function endExecution(success = true, stats = {}) {
  try {
    const state = await loadState();
    
    if (!state.executionMetrics) {
      state.executionMetrics = {};
    }
    
    const startTime = state.executionMetrics.lastRunStart ? 
      new Date(state.executionMetrics.lastRunStart) : new Date();
    
    const endTime = new Date();
    const duration = endTime - startTime;
    
    // Update execution metrics
    state.executionMetrics.lastRunTime = endTime.toISOString();
    state.executionMetrics.lastRunDuration = duration;
    
    // Calculate rolling average duration correctly
    const totalRuns = state.executionMetrics.totalRuns || 1;
    const prevAvg = state.executionMetrics.avgRunDuration || 0;
    const prevRuns = totalRuns > 1 ? totalRuns - 1 : 0;
    
    // Avoid divide by zero
    if (totalRuns > 0) {
      state.executionMetrics.avgRunDuration = prevRuns > 0 ? 
        (prevAvg * prevRuns + duration) / totalRuns : 
        duration;
    }
    
    // Calculate success rate correctly (ensure maximum of 100%)
    if (totalRuns > 0) {
      const prevSuccesses = Math.min(
        (state.executionMetrics.successRate || 100) * prevRuns / 100,
        prevRuns
      );
      const newSuccessCount = prevSuccesses + (success ? 1 : 0);
      state.executionMetrics.successRate = Math.min(
        (newSuccessCount / totalRuns) * 100,
        100
      );
    }
    
    // Add additional stats
    state.executionMetrics.lastRunStats = stats;
    
    await saveState(state);
    console.log(`✅ Completed execution (${success ? 'success' : 'failure'}) in ${duration}ms`);
  } catch (error) {
    console.error('❌ Failed to record execution end:', error);
  }
}

/**
 * Loads the last processed mention ID
 * @returns {Promise<string|null>} The last mention ID
 */
export async function loadLastMentionId() {
  const state = await loadState();
  return state.twitter.lastMentionId;
}

/**
 * Saves the last processed mention ID
 * @param {string} lastMentionId - The ID to save
 * @returns {Promise<boolean>} True if successful
 */
export async function saveLastMentionId(lastMentionId) {
  const state = await loadState();
  state.twitter.lastMentionId = lastMentionId;
  state.twitter.processedCount = (state.twitter.processedCount || 0) + 1;
  state.twitter.lastProcessedAt = new Date().toISOString();
  
  const success = await saveState(state);
  if (success) {
    console.log(`📝 Updated last mention ID: ${lastMentionId}`);
  }
  return success;
}

/**
 * Checks if a tweet has already been replied to
 * @param {string} tweetId - The tweet ID to check
 * @returns {Promise<boolean>} True if already replied to
 */
export async function hasRepliedToTweet(tweetId) {
  const state = await loadState();
  return !!state.replies.history[tweetId];
}

/**
 * Marks a tweet as replied to and stores metadata about the reply
 * Also cleans up old entries to prevent unlimited growth of the state file
 * 
 * @param {string} tweetId - The tweet ID
 * @param {Object} metadata - Optional metadata about the reply
 * @returns {Promise<boolean>} True if successful
 */
export async function markTweetAsReplied(tweetId, metadata = {}) {
  console.log(`📝 Marking tweet ${tweetId} as replied to...`);
  const state = await loadState();
  
  // Add the tweet to our replied list with timestamp and metadata
  state.replies.history[tweetId] = {
    repliedAt: new Date().toISOString(),
    ...metadata
  };
  
  // Update reply count
  state.replies.count = (state.replies.count || 0) + 1;
  
  // Update hero-specific stats
  if (metadata.heroName) {
    const heroName = metadata.heroName.toLowerCase();
    state.replies.byHero[heroName] = (state.replies.byHero[heroName] || 0) + 1;
  }
  
  // Clean up old entries (older than retention period) to prevent unlimited growth
  const now = new Date();
  const retentionPeriod = CONFIG.retentionDays * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(now.getTime() - retentionPeriod);
  
  let removedCount = 0;
  for (const [id, data] of Object.entries(state.replies.history)) {
    if (new Date(data.repliedAt) < cutoffDate) {
      delete state.replies.history[id];
      removedCount++;
    }
  }
  
  if (removedCount > 0) {
    console.log(`🧹 Cleaned up ${removedCount} old replied tweet entries (older than ${CONFIG.retentionDays} days)`);
  }
  
  const success = await saveState(state);
  if (success) {
    console.log(`✅ Tweet ${tweetId} marked as replied to`);
  }
  return success;
}

/**
 * Records an error in the state
 * @param {Error|string} error - The error object or message
 * @param {string} context - Context where the error occurred
 * @returns {Promise<void>}
 */
export async function recordError(error, context) {
  try {
    const state = await loadState();
    
    if (!state.errors) {
      state.errors = { count: 0, history: [] };
    }
    
    const errorEntry = {
      timestamp: new Date().toISOString(),
      context: context,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    };
    
    state.errors.count = (state.errors.count || 0) + 1;
    state.errors.last = errorEntry;
    
    // Add to history, keeping last 20 errors
    state.errors.history.unshift(errorEntry); // Add at beginning
    if (state.errors.history.length > 20) {
      state.errors.history = state.errors.history.slice(0, 20);
    }
    
    await saveState(state);
  } catch (err) {
    console.error('❌ Failed to record error in state:', err);
  }
}

/**
 * Gets statistics about application usage
 * @returns {Promise<Object>} Statistics object
 */
export async function getStatistics() {
  const state = await loadState();
  
  const stats = {
    uptime: process.uptime(),
    runtime: {
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      platform: os.platform(),
      memory: process.memoryUsage(),
    },
    replies: {
      total: state.replies.count || 0,
      byHero: state.replies.byHero || {},
      last: Object.entries(state.replies.history)
        .sort(([, a], [, b]) => new Date(b.repliedAt) - new Date(a.repliedAt))
        .slice(0, 5)
        .map(([id, data]) => ({
          tweetId: id, 
          ...data
        }))
    },
    twitter: {
      lastMentionId: state.twitter.lastMentionId,
      processedCount: state.twitter.processedCount || 0,
      lastProcessedAt: state.twitter.lastProcessedAt,
    },
    errors: {
      count: state.errors?.count || 0,
      last: state.errors?.last || null
    },
    executionMetrics: state.executionMetrics || {}
  };
  
  return stats;
}
