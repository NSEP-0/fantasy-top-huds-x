/**
 * Twitter Mention API Helper
 * 
 * Handles timestamp formatting and mention query parameters
 * to ensure consistency between environments
 */

/**
 * Calculate a safe start time for fetching mentions
 * This prevents missing mentions while handling time zones and system clock differences
 * 
 * @param {string|null} lastMentionId - The ID of the last processed mention
 * @returns {Object} Object containing formatted start_time and readable time info
 */
export function calculateMentionQueryTime(lastMentionId) {
  // If we have a last mention ID, we don't need a time filter
  // Twitter API will return mentions newer than that ID
  if (lastMentionId) {
    console.log(`🔍 Using since_id mode with ID: ${lastMentionId}`);
    return {
      useTimeFilter: false,
      sinceId: lastMentionId,
      readableTime: `Since tweet ID: ${lastMentionId}`,
      formattedTime: null,
      minutesAgo: 0
    };
  }
  
  console.log('⚠️ No lastMentionId found, falling back to time-based filtering');
  
  // No last mention ID, so we need to use a time-based filter
  // Default to 60 minutes if no last mention ID
  const minutesAgo = 60;
  
  // Calculate the time in the past
  const now = new Date();
  console.log(`🔍 Current time (local): ${now.toLocaleString()}`);
  console.log(`🔍 Current time (UTC/ISO): ${now.toISOString()}`);
  
  const startTime = new Date(now.getTime() - minutesAgo * 60 * 1000);
  console.log(`🔍 Calculated start time (local): ${startTime.toLocaleString()}`);
  console.log(`🔍 Calculated start time (raw UTC/ISO): ${startTime.toISOString()}`);
  
  // Format for Twitter API (ISO string)
  const formattedTime = startTime.toISOString().replace(/\.\d{3}Z$/, 'Z');
  console.log(`🔍 Formatted start_time for API: ${formattedTime}`);
  
  // Validate the formatted time string against Twitter's requirements
  // Twitter API requires: YYYY-MM-DDTHH:mm:ssZ (ISO 8601/RFC 3339)
  const isValidFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(formattedTime);
  console.log(`🔍 Is formatted time valid for Twitter API? ${isValidFormat ? 'Yes ✅' : 'No ❌'}`);
  
  if (!isValidFormat) {
    console.error('❌ WARNING: Timestamp format may not be compatible with Twitter API!');
    console.error('❌ Expected format: YYYY-MM-DDTHH:mm:ssZ (e.g., 2023-05-15T12:30:45Z)');
  }
  
  return {
    useTimeFilter: true,
    sinceId: null,
    readableTime: `Last ${minutesAgo} minutes (since ${startTime.toLocaleString()})`,
    formattedTime,
    minutesAgo
  };
}

/**
 * Validates a Twitter ID to ensure it's in the correct format
 * 
 * @param {string} id - The Twitter ID to validate
 * @returns {boolean} Whether the ID is valid
 */
export function isValidTwitterId(id) {
  // Twitter IDs are numeric strings
  return typeof id === 'string' && /^\d+$/.test(id) && id.length > 10;
}

/**
 * Validates a Twitter username
 * 
 * @param {string} username - Twitter username to validate
 * @returns {boolean} Whether the username is valid
 */
export function isValidTwitterUsername(username) {
  // Twitter usernames are alphanumeric with underscores, between 1-15 chars
  return typeof username === 'string' && 
         /^[a-zA-Z0-9_]{1,15}$/.test(username) &&
         username.length <= 15;
}

/**
 * Determines if a tweet is a direct mention (starts with @username)
 * or an indirect mention (includes @username anywhere else)
 * 
 * @param {Object} tweet - The tweet object from Twitter API
 * @param {string} botUsername - The bot's username (without @)
 * @returns {Object} Object containing mention type information
 */
export function getMentionType(tweet, botUsername) {
  // Default return object
  const result = {
    isDirect: false,
    isIndirect: false,
    mentionPosition: -1,
    originalText: tweet.text || ''
  };
  
  if (!tweet || !tweet.text || !botUsername) {
    return result;
  }
  
  // Normalize username (remove @ if present)
  const normalizedUsername = botUsername.startsWith('@') ? 
    botUsername.substring(1) : botUsername;
  
  // The mention pattern includes a word boundary to ensure we're matching the complete username
  const mentionPattern = new RegExp(`@${normalizedUsername}\\b`, 'i');
  
  // Check if the mention exists at all
  const mentionMatch = tweet.text.match(mentionPattern);
  if (!mentionMatch) {
    return result;
  }
  
  // Record the position where the mention was found
  const mentionPosition = mentionMatch.index;
  result.mentionPosition = mentionPosition;
  
  // Check if it's a direct mention (starts at position 0 or has only whitespace before)
  const textBeforeMention = tweet.text.substring(0, mentionPosition).trim();
  result.isDirect = textBeforeMention.length === 0;
  
  // If not direct, it's indirect
  result.isIndirect = !result.isDirect;
  
  // Remove all bot username mentions from the text to get the clean command
  // This helps with parsing the actual content
  result.cleanedText = tweet.text.replace(new RegExp(`@${normalizedUsername}\\b`, 'gi'), '').trim();
  
  return result;
}

/**
 * Extracts relevant user information from a tweet
 * 
 * @param {Object} tweet - The tweet object from Twitter API
 * @param {Object} users - The users object from Twitter API response
 * @returns {Object} Extracted user information
 */
export function extractUserInfo(tweet, users) {
  const userInfo = {
    authorId: tweet.author_id || null,
    authorUsername: null,
    authorDisplayName: null
  };
  
  // If we have author_id and users data, try to find the username
  if (tweet.author_id && users && Array.isArray(users)) {
    const authorUser = users.find(user => user.id === tweet.author_id);
    if (authorUser) {
      userInfo.authorUsername = authorUser.username || null;
      userInfo.authorDisplayName = authorUser.name || null;
    }
  }
  
  return userInfo;
}

/**
 * Creates the Twitter API parameters for fetching mentions
 * 
 * @param {string} userId - The Twitter user ID to fetch mentions for
 * @param {string|null} lastMentionId - The ID of the last processed mention
 * @returns {Object} Object containing the API request parameters and debug info
 */
export function createMentionQueryParams(userId, lastMentionId) {
  console.log(`🔧 Creating mention query params for userId=${userId}, lastMentionId=${lastMentionId || 'null'}`);
  
  const timeInfo = calculateMentionQueryTime(lastMentionId);
  
  // Build query parameters
  const params = {
    'tweet.fields': 'created_at,entities,author_id,in_reply_to_user_id',
    'expansions': 'author_id',
  };
  
  // Add either since_id or start_time parameter
  if (timeInfo.useTimeFilter) {
    console.log(`🔍 Using time-based filtering with start_time=${timeInfo.formattedTime}`);
    console.log(`🔍 Time range: ${timeInfo.readableTime}`);
    params.start_time = timeInfo.formattedTime;
  } else {
    console.log(`🔍 Using ID-based filtering with since_id=${timeInfo.sinceId}`);
    params.since_id = timeInfo.sinceId;
  }
  
  // Create the full URL (for logging/debugging)
  const baseUrl = `https://api.twitter.com/2/users/${userId}/mentions`;
  const queryString = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  const fullUrl = `${baseUrl}?${queryString}`;
  
  console.log(`🔗 Full Twitter API request URL: ${fullUrl}`);
  
  return {
    params,
    timeInfo,
    fullUrl
  };
}

/**
 * Determines if the bot should respond to a mention
 * Handles both direct and indirect mentions
 * 
 * @param {Object} tweet - The tweet object from Twitter API
 * @param {Object} mentionType - The mention type object from getMentionType()
 * @param {string} botUserId - The bot's user ID
 * @returns {boolean} Whether the bot should respond
 */
export function shouldRespondToMention(tweet, mentionType, botUserId) {
  // Don't respond if the tweet doesn't exist
  if (!tweet) return false;
  
  // Don't respond to our own tweets
  if (tweet.author_id === botUserId) return false;
  
  // Respond if it's a direct or indirect mention
  return mentionType.isDirect || mentionType.isIndirect;
}

/**
 * Formats a reply based on whether it's a direct or indirect mention
 * 
 * @param {Object} reply - The reply content
 * @param {Object} mentionType - The mention type object from getMentionType()
 * @param {Object} userInfo - The user info object from extractUserInfo()
 * @returns {string} The formatted reply text
 */
export function formatReplyText(reply, mentionType, userInfo) {
  // If it's a direct mention and we have the author's username, include it
  if (mentionType.isDirect && userInfo.authorUsername) {
    return `@${userInfo.authorUsername} ${reply.text}`;
  }
  
  // For indirect mentions or when username isn't available, just reply with the content
  return reply.text;
}
