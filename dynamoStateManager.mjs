/**
 * DynamoDB State Manager for Fantasy Top Twitter Bot
 * 
 * Provides persistent state storage using AWS DynamoDB
 */
import dotenv from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  DeleteCommand, 
  QueryCommand,
  UpdateCommand,
  BatchWriteCommand
} from '@aws-sdk/lib-dynamodb';

dotenv.config();

// DynamoDB Configuration
const CONFIG = {
  tableName: process.env.STATE_TABLE_NAME || 'FantasyBotState',
  region: process.env.AWS_REGION || 'us-east-1',
  enabled: process.env.USE_DYNAMO_STATE === 'true'
};

let dynamoInitialized = false;
let client = null;
let docClient = null;

/**
 * Initialize the DynamoDB client with error handling
 * @returns {boolean} Whether initialization was successful
 */
function initializeDynamo() {
  if (!CONFIG.enabled) {
    console.log('DynamoDB state manager is disabled via environment variable');
    return false;
  }
  
  try {
    if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SECRET_ACCESS_KEY && 
        process.env.NODE_ENV !== 'production') {
      console.warn('⚠️ AWS credentials not found in environment variables');
      
      // In Lambda these aren't needed as the role provides permissions
      if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
        return false;
      }
    }
    
    // Initialize DynamoDB client
    client = new DynamoDBClient({ 
      region: CONFIG.region
    });

    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        // Convert empty strings to null to comply with DynamoDB rules
        convertEmptyValues: true,
        // Remove undefined values
        removeUndefinedValues: true
      }
    });
    
    dynamoInitialized = true;
    console.log(`✅ DynamoDB client initialized for table ${CONFIG.tableName} in ${CONFIG.region}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize DynamoDB client:', error);
    dynamoInitialized = false;
    return false;
  }
}

/**
 * Format a state key into a consistent DynamoDB stateId format
 * @param {string} key - The logical state key
 * @param {string} [prefix] - Optional prefix category
 * @returns {string} - Formatted stateId
 */
function formatStateId(key, prefix) {
  if (prefix) {
    return `${prefix}_${key}`;
  }
  return key;
}

/**
 * Save state to DynamoDB
 * @param {string} key - The state key
 * @param {Object} data - The state data to save
 * @param {string} [prefix] - Optional prefix category 
 * @returns {Promise<boolean>} - Whether the save was successful
 */
export async function saveState(key, data, prefix) {
  if (!dynamoInitialized && !initializeDynamo()) {
    console.warn('⚠️ DynamoDB is not available. Operation will fail.');
    return false;
  }
  
  try {
    const stateId = formatStateId(key, prefix);
    console.log(`💾 Saving state '${stateId}' to DynamoDB`);
    
    // Add metadata
    const timestamp = new Date().toISOString();
    
    const item = {
      stateId,
      updatedAt: timestamp,
      data: JSON.stringify(data)  // Store as string to avoid DynamoDB type limitations
    };
    
    // Save to DynamoDB
    const command = new PutCommand({
      TableName: CONFIG.tableName,
      Item: item
    });
    
    await docClient.send(command);
    console.log(`✅ State '${stateId}' saved successfully to DynamoDB`);
    return true;
  } catch (error) {
    console.error(`❌ Error saving state '${key}' to DynamoDB:`, error);
    return false;
  }
}

/**
 * Load state from DynamoDB
 * @param {string} key - The state key to load
 * @param {string} [prefix] - Optional prefix category
 * @returns {Promise<Object|null>} - The state data or null if not found
 */
export async function loadState(key, prefix) {
  if (!dynamoInitialized && !initializeDynamo()) {
    console.warn('⚠️ DynamoDB is not available. Operation will fail.');
    return null;
  }
  
  try {
    const stateId = formatStateId(key, prefix);
    console.log(`📂 Loading state '${stateId}' from DynamoDB`);
    
    const command = new GetCommand({
      TableName: CONFIG.tableName,
      Key: {
        stateId
      }
    });
    
    const response = await docClient.send(command);
    
    if (!response.Item) {
      console.log(`⚠️ No state found for key '${stateId}'`);
      return null;
    }
    
    console.log(`✅ Successfully loaded state '${stateId}' from DynamoDB`);
    
    // Parse the JSON string back to an object
    try {
      return JSON.parse(response.Item.data);
    } catch (parseError) {
      console.error(`❌ Error parsing state data for '${stateId}':`, parseError);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error loading state '${key}' from DynamoDB:`, error);
    return null;
  }
}

/**
 * Delete state from DynamoDB
 * @param {string} key - The state key to delete
 * @param {string} [prefix] - Optional prefix category
 * @returns {Promise<boolean>} - Whether the deletion was successful
 */
export async function deleteState(key, prefix) {
  if (!dynamoInitialized && !initializeDynamo()) {
    console.warn('⚠️ DynamoDB is not available. Operation will fail.');
    return false;
  }
  
  try {
    const stateId = formatStateId(key, prefix);
    console.log(`🗑️ Deleting state '${stateId}' from DynamoDB`);
    
    const command = new DeleteCommand({
      TableName: CONFIG.tableName,
      Key: {
        stateId
      }
    });
    
    await docClient.send(command);
    console.log(`✅ State '${stateId}' deleted successfully from DynamoDB`);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting state '${key}' from DynamoDB:`, error);
    return false;
  }
}

/**
 * Check if a tweet has been replied to
 * @param {string} tweetId - The tweet ID to check
 * @returns {Promise<boolean>} - Whether the tweet has been replied to
 */
export async function hasRepliedToTweet(tweetId) {
  return !!(await loadState(tweetId, 'tweet'));
}

/**
 * Mark a tweet as replied to
 * @param {string} tweetId - The tweet ID
 * @param {Object} metadata - Optional metadata about the reply
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
export async function markTweetAsReplied(tweetId, metadata = {}) {
  // Add timestamp if not provided
  if (!metadata.repliedAt) {
    metadata.repliedAt = new Date().toISOString();
  }
  
  return await saveState(tweetId, metadata, 'tweet');
}

/**
 * Load the last processed mention ID
 * @returns {Promise<string|null>} - The last mention ID or null
 */
export async function loadLastMentionId() {
  const state = await loadState('lastMentionId');
  return state?.id || null;
}

/**
 * Save the last processed mention ID
 * @param {string} mentionId - The mention ID to save
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
export async function saveLastMentionId(mentionId) {
  if (!mentionId) return false;
  
  const now = new Date().toISOString();
  
  // Get existing state to update processedCount
  const existing = await loadState('lastMentionId') || { processedCount: 0 };
  
  const updatedState = {
    id: mentionId,
    processedCount: (existing.processedCount || 0) + 1,
    lastProcessedAt: now,
    updatedAt: now
  };
  
  return await saveState('lastMentionId', updatedState);
}

/**
 * Batch import state data into DynamoDB
 * @param {Object} stateData - Full state object to import
 * @returns {Promise<boolean>} - Whether the import was successful
 */
export async function importFullState(stateData) {
  if (!dynamoInitialized && !initializeDynamo()) {
    console.warn('⚠️ DynamoDB is not available. Operation will fail.');
    return false;
  }
  
  try {
    console.log('🔄 Importing full state data to DynamoDB...');
    
    // Save metadata
    await saveState('metadata', stateData.metadata);
    
    // Save Twitter state
    await saveState('lastMentionId', {
      id: stateData.twitter.lastMentionId,
      processedCount: stateData.twitter.processedCount || 0,
      lastProcessedAt: stateData.twitter.lastProcessedAt
    });
    
    // Save execution metrics
    await saveState('executionMetrics', stateData.executionMetrics);
    
    // Save errors
    await saveState('errors', stateData.errors);
    
    // Save replied tweets
    const tweetEntries = Object.entries(stateData.replies.history || {});
    console.log(`Importing ${tweetEntries.length} replied tweets...`);
    
    // Import in batches to stay within DynamoDB limits
    const BATCH_SIZE = 25;
    for (let i = 0; i < tweetEntries.length; i += BATCH_SIZE) {
      const batch = tweetEntries.slice(i, i + BATCH_SIZE);
      
      // Process each batch
      await Promise.all(batch.map(([tweetId, metadata]) => 
        markTweetAsReplied(tweetId, metadata)
      ));
      
      console.log(`Imported tweets batch ${i+1} to ${Math.min(i+BATCH_SIZE, tweetEntries.length)}`);
    }
    
    // Save hero statistics
    await saveState('heroStats', stateData.replies.byHero || {});
    
    // Save total reply count
    await saveState('replyCount', { count: stateData.replies.count || 0 });
    
    console.log('✅ Full state import to DynamoDB completed successfully');
    return true;
  } catch (error) {
    console.error('❌ Error importing full state to DynamoDB:', error);
    return false;
  }
}

/**
 * Export the full state from DynamoDB
 * @returns {Promise<Object|null>} - The exported state or null on failure
 */
export async function exportFullState() {
  if (!dynamoInitialized && !initializeDynamo()) {
    console.warn('⚠️ DynamoDB is not available. Operation will fail.');
    return null;
  }
  
  try {
    console.log('🔄 Exporting full state from DynamoDB...');
    
    // Load core state components
    const metadata = await loadState('metadata') || {};
    const lastMentionState = await loadState('lastMentionId') || {};
    const executionMetrics = await loadState('executionMetrics') || {};
    const errors = await loadState('errors') || { count: 0, history: [] };
    const heroStats = await loadState('heroStats') || {};
    const replyCountData = await loadState('replyCount') || { count: 0 };
    
    // Query all replied tweets (using prefix in stateId)
    const repliedTweets = {};
    try {
      let lastEvaluatedKey = null;
      do {
        const queryCommand = new QueryCommand({
          TableName: CONFIG.tableName,
          KeyConditionExpression: "begins_with(stateId, :prefix)",
          ExpressionAttributeValues: {
            ":prefix": "tweet_"
          },
          ExclusiveStartKey: lastEvaluatedKey
        });
        
        const response = await docClient.send(queryCommand);
        
        // Process tweets in this batch
        for (const item of response.Items || []) {
          const tweetId = item.stateId.replace('tweet_', '');
          try {
            repliedTweets[tweetId] = JSON.parse(item.data);
          } catch (e) {
            console.warn(`Could not parse data for tweet ${tweetId}:`, e);
          }
        }
        
        lastEvaluatedKey = response.LastEvaluatedKey;
      } while (lastEvaluatedKey);
      
    } catch (queryError) {
      console.error('Error querying replied tweets:', queryError);
    }
    
    // Assemble the full state object
    const fullState = {
      metadata,
      twitter: {
        lastMentionId: lastMentionState.id || null,
        processedCount: lastMentionState.processedCount || 0,
        lastProcessedAt: lastMentionState.lastProcessedAt
      },
      replies: {
        count: replyCountData.count || 0,
        byHero: heroStats,
        history: repliedTweets
      },
      executionMetrics,
      errors
    };
    
    console.log('✅ Full state export from DynamoDB completed successfully');
    return fullState;
  } catch (error) {
    console.error('❌ Error exporting full state from DynamoDB:', error);
    return null;
  }
}

// Initialize DynamoDB when this module is imported
initializeDynamo();
