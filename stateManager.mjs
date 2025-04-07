/**
 * stateManager.mjs - Enhanced state persistence with automatic fallback
 * 
 * Features:
 * - Primary support for cloud storage via DynamoDB
 * - Automatic fallback to file-based storage when cloud fails
 * - Comprehensive execution metrics and statistics
 * - Built-in error tracking and recovery
 */
import os from 'os';
import * as dynamoDB from './dynamoStateManager.mjs';
import * as fileSystem from './fileStateManager.mjs';

// Environment configuration with defaults to improve local development
const USE_DYNAMO = process.env.USE_DYNAMO_STATE === 'true';
const FALLBACK_TO_FILE = process.env.FALLBACK_TO_FILE !== 'false'; // Default to true
const IS_LAMBDA = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

console.log(`🔧 State Manager: Using ${USE_DYNAMO ? 'DynamoDB' : 'File'} storage with ${FALLBACK_TO_FILE ? 'enabled' : 'disabled'} file fallback`);
console.log(`🔧 Running in AWS Lambda: ${IS_LAMBDA}`);

// State version for future compatibility
const STATE_VERSION = '2.0.0';

// Error contexts that should not be recorded in state
const IGNORED_ERROR_CONTEXTS = [
  'Failed to get username for author_id',
  'Response code 429 (Too Many Requests)'
];

/**
 * Checks if an error should be ignored (not recorded in state)
 * @param {Error|string} error - The error object or message
 * @param {string} context - Error context
 * @returns {boolean} Whether the error should be ignored
 */
function shouldIgnoreError(error, context) {
  // Check if context matches any ignored patterns
  if (IGNORED_ERROR_CONTEXTS.some(pattern => context.includes(pattern))) {
    return true;
  }
  
  // Check for rate limit errors
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Rate limit') || message.includes('Too Many Requests') || 
      message.includes('429')) {
    return true;
  }
  
  return false;
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
    executionMetrics: {
      totalRuns: 0,
      lastRunTime: null,
      lastRunDuration: 0,
      avgRunDuration: 0,
      successRate: 100,
      currentExecutionId: null
    },
    errors: {
      count: 0,
      last: null,
      history: []
    },
    statistics: {
      uptime: 0,
      mentionsProcessed: 0,
      repliesSent: 0,
      errorCount: 0
    }
  };
}

/**
 * Loads the last processed mention ID
 * @returns {Promise<string|null>} The last mention ID
 */
export async function loadLastMentionId() {
  try {
    console.log('📂 Loading last mention ID from state...');
    let mentionId = null;
    
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      mentionId = await dynamoDB.loadLastMentionId();
      if (mentionId) {
        console.log(`📝 Found last mention ID in DynamoDB: ${mentionId}`);
        return mentionId;
      }
      
      // Log fallback attempt
      if (FALLBACK_TO_FILE) {
        console.log(`⚠️ No mention ID found in DynamoDB, falling back to file storage`);
      }
    }
    
    // Try file storage if DynamoDB is disabled or failed to find the ID
    if (!USE_DYNAMO || (FALLBACK_TO_FILE && !mentionId)) {
      try {
        // Load full state from file
        const fileState = await fileSystem.loadState('state');
        if (fileState?.twitter?.lastMentionId) {
          console.log(`📝 Found last mention ID in file: ${fileState.twitter.lastMentionId}`);
          return fileState.twitter.lastMentionId;
        }
      } catch (error) {
        console.error('❌ Error loading last mention ID from file:', error);
      }
    }
    
    console.log('📜 No last mention ID found in any storage');
    return null;
  } catch (error) {
    console.error('❌ Error loading last mention ID:', error);
    return null;
  }
}

/**
 * Saves the last processed mention ID
 * @param {string} mentionId - The ID to save
 * @returns {Promise<boolean>} True if successful
 */
export async function saveLastMentionId(mentionId) {
  if (!mentionId) {
    console.warn('⚠️ Attempted to save empty mention ID. Ignoring request.');
    return false;
  }
  
  try {
    console.log(`📝 Saving last mention ID: ${mentionId}`);
    let success = false;
    
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      success = await dynamoDB.saveLastMentionId(mentionId);
      
      // If DynamoDB succeeded, we're done
      if (success) return true;
      
      // Log fallback attempt
      if (FALLBACK_TO_FILE) {
        console.log(`⚠️ Failed to save mention ID to DynamoDB, falling back to file storage`);
      }
    }
    
    // Try file storage if DynamoDB is disabled or failed
    if (!USE_DYNAMO || (FALLBACK_TO_FILE && !success)) {
      // We need to load the current state first
      const fileState = await fileSystem.loadState('state') || getDefaultState();
      
      // Update the last mention ID
      fileState.twitter = fileState.twitter || {};
      fileState.twitter.lastMentionId = mentionId;
      fileState.twitter.processedCount = (fileState.twitter.processedCount || 0) + 1;
      fileState.twitter.lastProcessedAt = new Date().toISOString();
      
      // Save the updated state
      success = await fileSystem.saveState('state', fileState);
    }
    
    if (success) {
      console.log(`✅ Last mention ID saved: ${mentionId}`);
    } else {
      console.error(`❌ Failed to save last mention ID: ${mentionId}`);
    }
    
    return success;
  } catch (error) {
    console.error('❌ Error saving last mention ID:', error);
    return false;
  }
}

/**
 * Checks if a tweet has already been replied to
 * @param {string} tweetId - The tweet ID to check
 * @returns {Promise<boolean>} True if already replied to
 */
export async function hasRepliedToTweet(tweetId) {
  try {
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      const replied = await dynamoDB.hasRepliedToTweet(tweetId);
      if (replied) {
        return true;
      }
      
      // If we found nothing and don't need to check file storage, return false
      if (!FALLBACK_TO_FILE) {
        return false;
      }
    }
    
    // Otherwise check file storage
    const fileState = await fileSystem.loadState('state');
    return !!fileState?.replies?.history?.[tweetId];
  } catch (error) {
    console.error(`❌ Error checking if tweet ${tweetId} has been replied to:`, error);
    return false;
  }
}

/**
 * Marks a tweet as replied to and stores metadata about the reply
 * @param {string} tweetId - The tweet ID
 * @param {Object} metadata - Optional metadata about the reply
 * @returns {Promise<boolean>} True if successful
 */
export async function markTweetAsReplied(tweetId, metadata = {}) {
  try {
    console.log(`📝 Marking tweet ${tweetId} as replied to...`);
    let success = false;
    
    // Add timestamp if not provided
    if (!metadata.repliedAt) {
      metadata.repliedAt = new Date().toISOString();
    }
    
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      success = await dynamoDB.markTweetAsReplied(tweetId, metadata);
      
      // Also update hero stats and reply count
      if (success && metadata.heroName) {
        const heroName = metadata.heroName.toLowerCase();
        
        // Load current hero stats
        const heroStats = await dynamoDB.loadState('heroStats') || {};
        heroStats[heroName] = (heroStats[heroName] || 0) + 1;
        await dynamoDB.saveState('heroStats', heroStats);
        
        // Update reply count
        const replyCountData = await dynamoDB.loadState('replyCount') || { count: 0 };
        replyCountData.count++;
        await dynamoDB.saveState('replyCount', replyCountData);
      }
      
      // If DynamoDB succeeded, we're done
      if (success) return true;
      
      // Log fallback attempt
      if (FALLBACK_TO_FILE) {
        console.log(`⚠️ Failed to mark tweet as replied in DynamoDB, falling back to file storage`);
      }
    }
    
    // Try file storage if DynamoDB is disabled or failed
    if (!USE_DYNAMO || (FALLBACK_TO_FILE && !success)) {
      // Load current state
      const fileState = await fileSystem.loadState('state') || getDefaultState();
      
      // Initialize replies if needed
      if (!fileState.replies) {
        fileState.replies = { count: 0, byHero: {}, history: {} };
      }
      
      // Add the tweet to our replied list
      fileState.replies.history[tweetId] = metadata;
      
      // Update reply count
      fileState.replies.count = (fileState.replies.count || 0) + 1;
      
      // Update hero-specific stats
      if (metadata.heroName) {
        const heroName = metadata.heroName.toLowerCase();
        fileState.replies.byHero[heroName] = (fileState.replies.byHero[heroName] || 0) + 1;
      }
      
      // Save the updated state
      success = await fileSystem.saveState('state', fileState);
    }
    
    if (success) {
      console.log(`✅ Tweet ${tweetId} marked as replied to`);
    } else {
      console.error(`❌ Failed to mark tweet ${tweetId} as replied to`);
    }
    
    return success;
  } catch (error) {
    console.error(`❌ Error marking tweet ${tweetId} as replied to:`, error);
    return false;
  }
}

/**
 * Records the start of an execution run
 * @returns {Promise<string>} Execution ID for this run
 */
export async function startExecution() {
  try {
    const executionId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    console.log(`🚀 Starting execution: ${executionId}`);
    
    let success = false;
    let metrics = {
      totalRuns: 0,
      lastRunStart: null,
      currentExecutionId: null
    };
    
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      // Get existing metrics
      metrics = await dynamoDB.loadState('executionMetrics') || metrics;
      
      // Update metrics
      metrics.totalRuns = (metrics.totalRuns || 0) + 1;
      metrics.lastRunStart = new Date().toISOString();
      metrics.currentExecutionId = executionId;
      
      // Save to DynamoDB
      success = await dynamoDB.saveState('executionMetrics', metrics);
      
      // If DynamoDB succeeded, we're done
      if (success) return executionId;
      
      // Log fallback attempt
      if (FALLBACK_TO_FILE) {
        console.log(`⚠️ Failed to record execution start in DynamoDB, falling back to file storage`);
      }
    }
    
    // Try file storage if DynamoDB is disabled or failed
    if (!USE_DYNAMO || (FALLBACK_TO_FILE && !success)) {
      // Load current state
      const fileState = await fileSystem.loadState('state') || getDefaultState();
      
      // Initialize execution metrics if needed
      fileState.executionMetrics = fileState.executionMetrics || {};
      
      // Update metrics
      fileState.executionMetrics.totalRuns = (fileState.executionMetrics.totalRuns || 0) + 1;
      fileState.executionMetrics.lastRunStart = new Date().toISOString();
      fileState.executionMetrics.currentExecutionId = executionId;
      
      // Save the updated state
      success = await fileSystem.saveState('state', fileState);
    }
    
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
    console.log(`🏁 Ending execution (${success ? 'success' : 'failure'})`);
    let savedToDb = false;
    let metrics = null;
    
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      // Get existing metrics
      metrics = await dynamoDB.loadState('executionMetrics');
      
      if (metrics) {
        const startTime = metrics.lastRunStart ? 
          new Date(metrics.lastRunStart) : new Date();
        
        const endTime = new Date();
        const duration = endTime - startTime;
        
        // Update metrics
        metrics.lastRunTime = endTime.toISOString();
        metrics.lastRunDuration = duration;
        metrics.lastRunStats = stats;
        
        // Calculate rolling average duration
        const totalRuns = metrics.totalRuns || 1;
        const prevAvg = metrics.avgRunDuration || 0;
        const prevRuns = totalRuns > 1 ? totalRuns - 1 : 0;
        
        if (totalRuns > 0) {
          metrics.avgRunDuration = prevRuns > 0 ? 
            (prevAvg * prevRuns + duration) / totalRuns : duration;
        }
        
        // Calculate success rate
        if (totalRuns > 0) {
          const prevSuccesses = Math.min(
            (metrics.successRate || 100) * prevRuns / 100,
            prevRuns
          );
          const newSuccessCount = prevSuccesses + (success ? 1 : 0);
          metrics.successRate = Math.min(
            (newSuccessCount / totalRuns) * 100,
            100
          );
        }
        
        // Save to DynamoDB
        savedToDb = await dynamoDB.saveState('executionMetrics', metrics);
      }
      
      // If DynamoDB succeeded, we're done
      if (savedToDb) return;
      
      // Log fallback attempt
      if (FALLBACK_TO_FILE) {
        console.log(`⚠️ Failed to record execution end in DynamoDB, falling back to file storage`);
      }
    }
    
    // Try file storage if DynamoDB is disabled or failed
    if (!USE_DYNAMO || (FALLBACK_TO_FILE && !savedToDb)) {
      // Load current state
      const fileState = await fileSystem.loadState('state') || getDefaultState();
      
      // Initialize execution metrics if needed
      fileState.executionMetrics = fileState.executionMetrics || {};
      
      const startTime = fileState.executionMetrics.lastRunStart ? 
        new Date(fileState.executionMetrics.lastRunStart) : new Date();
      
      const endTime = new Date();
      const duration = endTime - startTime;
      
      // Update metrics
      fileState.executionMetrics.lastRunTime = endTime.toISOString();
      fileState.executionMetrics.lastRunDuration = duration;
      fileState.executionMetrics.lastRunStats = stats;
      
      // Calculate rolling average duration
      const totalRuns = fileState.executionMetrics.totalRuns || 1;
      const prevAvg = fileState.executionMetrics.avgRunDuration || 0;
      const prevRuns = totalRuns > 1 ? totalRuns - 1 : 0;
      
      if (totalRuns > 0) {
        fileState.executionMetrics.avgRunDuration = prevRuns > 0 ? 
          (prevAvg * prevRuns + duration) / totalRuns : duration;
      }
      
      // Calculate success rate
      if (totalRuns > 0) {
        const prevSuccesses = Math.min(
          (fileState.executionMetrics.successRate || 100) * prevRuns / 100,
          prevRuns
        );
        const newSuccessCount = prevSuccesses + (success ? 1 : 0);
        fileState.executionMetrics.successRate = Math.min(
          (newSuccessCount / totalRuns) * 100,
          100
        );
      }
      
      // Save the updated state
      await fileSystem.saveState('state', fileState);
    }
  } catch (error) {
    console.error('❌ Failed to record execution end:', error);
  }
}

/**
 * Records an error in the state
 * @param {Error|string} error - The error object or message
 * @param {string} context - Context where the error occurred
 * @returns {Promise<void>}
 */
export async function recordError(error, context) {
  try {
    // Skip recording for certain known errors
    if (shouldIgnoreError(error, context)) {
      console.log(`📝 Not recording known error: ${context}`);
      return;
    }
    
    const errorEntry = {
      timestamp: new Date().toISOString(),
      context: context,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    };
    
    let savedToDb = false;
    
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      // Get existing errors
      const errors = await dynamoDB.loadState('errors') || { count: 0, history: [] };
      
      // Update errors
      errors.count = (errors.count || 0) + 1;
      errors.last = errorEntry;
      
      // Add to history, keeping last 20 errors
      errors.history.unshift(errorEntry);
      if (errors.history.length > 20) {
        errors.history = errors.history.slice(0, 20);
      }
      
      // Save to DynamoDB
      savedToDb = await dynamoDB.saveState('errors', errors);
      
      // If DynamoDB succeeded, we're done
      if (savedToDb) return;
      
      // Log fallback attempt
      if (FALLBACK_TO_FILE) {
        console.log(`⚠️ Failed to record error in DynamoDB, falling back to file storage`);
      }
    }
    
    // Try file storage if DynamoDB is disabled or failed
    if (!USE_DYNAMO || (FALLBACK_TO_FILE && !savedToDb)) {
      // Load current state
      const fileState = await fileSystem.loadState('state') || getDefaultState();
      
      // Initialize errors if needed
      fileState.errors = fileState.errors || { count: 0, history: [] };
      
      // Update errors
      fileState.errors.count = (fileState.errors.count || 0) + 1;
      fileState.errors.last = errorEntry;
      
      // Add to history, keeping last 20 errors
      fileState.errors.history.unshift(errorEntry);
      if (fileState.errors.history.length > 20) {
        fileState.errors.history = fileState.errors.history.slice(0, 20);
      }
      
      // Save the updated state
      await fileSystem.saveState('state', fileState);
    }
  } catch (err) {
    console.error('❌ Failed to record error in state:', err);
  }
}

/**
 * Resets the application state to default
 * @returns {Promise<boolean>} True if reset was successful
 */
export async function resetState() {
  try {
    console.log('🧹 Resetting application state to clean slate...');
    
    const freshState = getDefaultState();
    let success = false;
    
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      // Clear all DynamoDB state
      await dynamoDB.saveState('metadata', freshState.metadata);
      await dynamoDB.saveState('lastMentionId', { id: null, processedCount: 0 });
      await dynamoDB.saveState('executionMetrics', freshState.executionMetrics);
      await dynamoDB.saveState('errors', freshState.errors);
      await dynamoDB.saveState('heroStats', {});
      await dynamoDB.saveState('replyCount', { count: 0 });
      
      success = true;
      console.log('✅ DynamoDB state reset successfully');
      
      // If we're not using file fallback, we're done
      if (!FALLBACK_TO_FILE) return success;
    }
    
    // Also reset file state
    success = await fileSystem.saveState('state', freshState);
    if (success) {
      console.log('✅ File state reset successfully');
    }
    
    return success;
  } catch (error) {
    console.error('❌ Error resetting state:', error);
    return false;
  }
}

/**
 * Gets statistics about application usage
 * @returns {Promise<Object>} Statistics object
 */
export async function getStatistics() {
  try {
    let stats = {
      uptime: process.uptime(),
      runtime: {
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        platform: os.platform(),
        memory: process.memoryUsage(),
      },
      twitter: {
        lastMentionId: null,
        processedCount: 0,
        lastProcessedAt: null,
      },
      replies: {
        total: 0,
        byHero: {},
        last: []
      },
      errors: {
        count: 0,
        last: null
      },
      executionMetrics: {},
      storage: {
        primary: USE_DYNAMO ? 'DynamoDB' : 'File',
        fallback: FALLBACK_TO_FILE ? 'Enabled' : 'Disabled'
      }
    };
    
    // Try DynamoDB first if enabled
    if (USE_DYNAMO) {
      const mentionState = await dynamoDB.loadState('lastMentionId');
      const executionMetrics = await dynamoDB.loadState('executionMetrics');
      const errors = await dynamoDB.loadState('errors');
      const heroStats = await dynamoDB.loadState('heroStats');
      const replyCountData = await dynamoDB.loadState('replyCount');
      
      // Update stats with DynamoDB data
      if (mentionState) {
        stats.twitter.lastMentionId = mentionState.id;
        stats.twitter.processedCount = mentionState.processedCount || 0;
        stats.twitter.lastProcessedAt = mentionState.lastProcessedAt;
      }
      
      if (executionMetrics) {
        stats.executionMetrics = executionMetrics;
      }
      
      if (errors) {
        stats.errors.count = errors.count || 0;
        stats.errors.last = errors.last || null;
      }
      
      if (heroStats) {
        stats.replies.byHero = heroStats;
      }
      
      if (replyCountData) {
        stats.replies.total = replyCountData.count || 0;
      }
      
      // Get recent tweets
      const recentTweets = [];
      try {
        // Query recent tweets (using last 5 by timestamp)
        let lastEvaluatedKey = null;
        const queryCommand = {
          TableName: process.env.STATE_TABLE_NAME || 'FantasyBotState',
          KeyConditionExpression: "begins_with(stateId, :prefix)",
          ExpressionAttributeValues: {
            ":prefix": "tweet_"
          },
          Limit: 5,
          ScanIndexForward: false // Sort descending by key
        };
        
        const response = await dynamoDB.queryItems(queryCommand);
        
        for (const item of response.Items || []) {
          const tweetId = item.stateId.replace('tweet_', '');
          try {
            const tweetData = JSON.parse(item.data);
            recentTweets.push({
              tweetId,
              ...tweetData
            });
          } catch (e) {
            console.warn(`Could not parse data for tweet ${tweetId}`);
          }
        }
        
        stats.replies.last = recentTweets;
      } catch (error) {
        console.error('Error querying recent tweets:', error);
      }
      
      // If we got data from DynamoDB and aren't using file fallback, return it
      if (stats.twitter.lastMentionId !== null && !FALLBACK_TO_FILE) {
        return stats;
      }
    }
    
    // If we're here, either DynamoDB is disabled, fallback is enabled, or DynamoDB didn't have data
    try {
      // Load file state
      const fileState = await fileSystem.loadState('state');
      
      if (fileState) {
        // Overwrite only null or zero values with file data
        if (stats.twitter.lastMentionId === null) {
          stats.twitter.lastMentionId = fileState.twitter?.lastMentionId || null;
        }
        
        if (stats.twitter.processedCount === 0) {
          stats.twitter.processedCount = fileState.twitter?.processedCount || 0;
        }
        
        if (stats.twitter.lastProcessedAt === null) {
          stats.twitter.lastProcessedAt = fileState.twitter?.lastProcessedAt || null;
        }
        
        if (stats.replies.total === 0) {
          stats.replies.total = fileState.replies?.count || 0;
        }
        
        if (Object.keys(stats.replies.byHero).length === 0) {
          stats.replies.byHero = fileState.replies?.byHero || {};
        }
        
        if (stats.replies.last.length === 0) {
          // Get the 5 most recent tweets
          const tweetEntries = Object.entries(fileState.replies?.history || {});
          stats.replies.last = tweetEntries
            .sort(([, a], [, b]) => new Date(b.repliedAt) - new Date(a.repliedAt))
            .slice(0, 5)
            .map(([id, data]) => ({
              tweetId: id,
              ...data
            }));
        }
        
        if (stats.errors.count === 0) {
          stats.errors.count = fileState.errors?.count || 0;
          stats.errors.last = fileState.errors?.last || null;
        }
        
        if (Object.keys(stats.executionMetrics).length === 0) {
          stats.executionMetrics = fileState.executionMetrics || {};
        }
      }
    } catch (error) {
      console.error('Error loading statistics from file:', error);
    }
    
    return stats;
  } catch (error) {
    console.error('❌ Error getting statistics:', error);
    
    // Return minimal stats on error
    return {
      uptime: process.uptime(),
      runtime: {
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        platform: os.platform()
      },
      error: error.message
    };
  }
}

/**
 * Synchronize state between DynamoDB and file storage
 * @param {string} direction - 'toFile' or 'toDynamo'
 * @returns {Promise<boolean>} Whether sync was successful
 */
export async function synchronizeState(direction = 'toDynamo') {
  try {
    console.log(`🔄 Synchronizing state ${direction === 'toDynamo' ? 'from file to DynamoDB' : 'from DynamoDB to file'}...`);
    
    if (direction === 'toDynamo') {
      // Load state from file
      const fileState = await fileSystem.loadState('state');
      if (!fileState) {
        console.error('❌ No state file found to sync to DynamoDB');
        return false;
      }
      
      // Import to DynamoDB
      const success = await dynamoDB.importFullState(fileState);
      if (success) {
        console.log('✅ State successfully synchronized from file to DynamoDB');
      }
      return success;
    } else {
      // Export from DynamoDB
      const dynamoState = await dynamoDB.exportFullState();
      if (!dynamoState) {
        console.error('❌ No state found in DynamoDB to sync to file');
        return false;
      }
      
      // Save to file
      const success = await fileSystem.saveState('state', dynamoState);
      if (success) {
        console.log('✅ State successfully synchronized from DynamoDB to file');
      }
      return success;
    }
  } catch (error) {
    console.error('❌ Error synchronizing state:', error);
    return false;
  }
}
