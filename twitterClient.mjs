// twitterClient.mjs
import got from 'got';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { formatTwitterDate } from './utils/formatters.mjs';
import { loadTokens } from './auth.mjs'; // Adjust path if needed

const endpointURL = 'https://api.twitter.com/2/tweets';

// Initialize OAuth 1.0a with your consumer credentials.
const oauth = OAuth({
  consumer: {
    key: process.env.CONSUMER_KEY,
    secret: process.env.CONSUMER_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function: (baseString, key) =>
    crypto.createHmac('sha1', key).update(baseString).digest('base64'),
});

/**
 * Posts a tweet using OAuth 1.0a tokens.
 *
 * @param {object} tokens - An object with {oauth_token, oauth_token_secret}.
 * @param {string} text - The tweet content.
 * @param {string|null} [replyToTweetId=null] - (Optional) Tweet ID to reply to.
 * @returns {Promise<object>} The response from Twitter.
 * @throws {Error} Enhanced error object with additional context
 */
export async function postTweet(tokens, text, replyToTweetId = null) {
  if (!tokens || !tokens.oauth_token || !tokens.oauth_token_secret) {
    throw new Error('Missing OAuth tokens');
  }

  const token = {
    key: tokens.oauth_token,
    secret: tokens.oauth_token_secret,
  };

  const authHeader = oauth.toHeader(
    oauth.authorize(
      {
        url: endpointURL,
        method: 'POST',
      },
      token
    )
  );

  const tweetData = { text };
  if (replyToTweetId) {
    tweetData.reply = { in_reply_to_tweet_id: replyToTweetId };
  }

  try {
    const response = await got.post(endpointURL, {
      json: tweetData,
      responseType: 'json',
      headers: {
        Authorization: authHeader.Authorization,
        'User-Agent': 'SimpleTwitterBot',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    console.log('Response:', response.body);
    return response.body;
  } catch (error) {
    // Enhanced error handling for Twitter API errors
    let enhancedError;
    
    if (error.response && error.response.body) {
      const errorBody = error.response.body;
      const statusCode = error.response.statusCode;
      
      // Format the error message to be more descriptive
      let errorMessage = `Twitter API Error (${statusCode}): `;
      
      if (typeof errorBody === 'object') {
        // Extract relevant error details
        if (errorBody.detail) errorMessage += errorBody.detail;
        if (errorBody.title) errorMessage += ` - ${errorBody.title}`;
        
        // Create an enhanced error with the Twitter error details attached
        enhancedError = new Error(errorMessage);
        enhancedError.statusCode = statusCode;
        enhancedError.twitterError = errorBody;
        enhancedError.isTwitterError = true;
        
        // Add specific error codes for common issues
        if (statusCode === 403) {
          enhancedError.code = 'TWITTER_FORBIDDEN';
          
          // Add hints for common forbidden errors
          if (errorBody.detail && errorBody.detail.includes('not permitted')) {
            enhancedError.hint = 'This could be due to permission issues with your Twitter developer app or attempting to post duplicate content.';
          }
        } else if (statusCode === 401) {
          enhancedError.code = 'TWITTER_UNAUTHORIZED';
          enhancedError.hint = 'Your authentication tokens may be expired or invalid. Try resetting tokens and authenticating again.';
        } else if (statusCode === 429) {
          enhancedError.code = 'TWITTER_RATE_LIMIT';
          enhancedError.hint = 'You have hit Twitter\'s rate limit. Please wait before trying again.';
        }
      } else {
        // If the error body isn't an object, use it directly in the message
        errorMessage += String(errorBody);
        enhancedError = new Error(errorMessage);
        enhancedError.statusCode = statusCode;
        enhancedError.isTwitterError = true;
      }
      
      console.error('Error posting tweet:', enhancedError.message);
      if (enhancedError.hint) {
        console.error('Hint:', enhancedError.hint);
      }
    } else {
      // For non-API errors (network issues, etc)
      enhancedError = error;
      console.error('Error posting tweet:', error.message);
    }
    
    // Properly throw the enhanced error for the caller to catch
    throw enhancedError;
  }
}

/**
 * If this module is run directly, post a test tweet using tokens loaded from auth.mjs.
 * Usage:
 *   node twitterClient.mjs "Your test tweet here"
 */
if (process.argv[1].includes('twitterClient.mjs')) {
  (async () => {
    try {
      // Grab tokens from your local tokens.json (or however you've set it up).
      const tokens = await loadTokens();
      if (!tokens) {
        console.error('No tokens found. Please run OAuth flow first in your main bot file.');
        process.exit(1);
      }

      // Accept a test tweet message from the command line arguments
      // or default to something random if none provided.
      const testTweet = process.argv[2] || `Hello from testTweet! ${Date.now()}`;
      console.log(`Attempting to post test tweet: "${testTweet}"`);

      await postTweet(tokens, testTweet);
      console.log('Test tweet posted successfully!');
    } catch (error) {
      console.error('Error during test tweet:', error);
    }
  })();
}

/**
 * Fetches recent mentions for the authenticated user from Twitter API
 * Provides flexible options for time-based or ID-based filtering
 * Includes robust error handling for API rate limits
 * 
 * @param {Object} options - Options for fetching mentions
 * @param {string} [options.sinceId] - Only fetch tweets newer than this ID
 * @param {number} [options.minutesAgo] - Only fetch tweets from the last X minutes
 * @returns {Promise<Array>} - An array of mention tweets or empty array if none
 */
export async function getMentions(options = {}) {
  const userId = process.env.TWITTER_USER_ID;
  if (!userId) {
    console.error('❌ TWITTER_USER_ID not defined in environment variables');
    throw new Error('TWITTER_USER_ID not defined in environment variables');
  }

  console.log(`🔍 Fetching mentions for user ID: ${userId}...`);
  
  try {  
    // Include more fields in the API request for better processing
    let url = `https://api.twitter.com/2/users/${userId}/mentions?tweet.fields=created_at,entities,author_id,in_reply_to_user_id&expansions=author_id`;
    
    // Note: removed user.fields=username as it might be causing issues with some API versions
    
    // Add start_time parameter if minutesAgo is provided - use the correct format
    if (options.minutesAgo) {
      // Cap at 24 hours to avoid potential issues
      const safeMinutesAgo = Math.min(options.minutesAgo, 24 * 60);
      
      // For older API versions, use a different date format
      const startTime = new Date(Date.now() - (safeMinutesAgo * 60 * 1000));
      const formattedTime = formatTwitterDate(startTime);
      url += `&start_time=${formattedTime}`;
      console.log(`⏰ Time range filter: Last ${safeMinutesAgo} minutes (since ${startTime.toLocaleString()})`);
      console.log(`📅 Twitter API start_time format: ${formattedTime}`);
    }

    // Add sinceId parameter if provided
    if (options.sinceId) {
      url += `&since_id=${options.sinceId}`;
      console.log(`🔢 ID-based filter: Mentions since ID ${options.sinceId}`);
    }
    
    console.log(`🔗 Full Twitter API request URL: ${url}`);
    
    // Use the same OAuth mechanism as for posting tweets
    console.log('🔑 Loading authentication tokens...');
    const tokens = await loadTokens();
    if (!tokens) {
      throw new Error('Missing OAuth tokens');
    }
    
    // Use proper OAuth 1.0a authentication with exact URL used in the request
    const token = {
      key: tokens.oauth_token,
      secret: tokens.oauth_token_secret,
    };
    
    const authHeader = oauth.toHeader(
      oauth.authorize({
        url,
        method: 'GET'
      }, token)
    );
    
    console.log('📡 Sending request to Twitter API...');
    const response = await got.get(url, {
      headers: {
        Authorization: authHeader['Authorization'],
        'Content-Type': 'application/json',
        // Add User-Agent header which is sometimes required
        'User-Agent': 'FantasyTopTwitterBot/1.0'
      },
      responseType: 'json',
      retry: {
        limit: 3,
        methods: ['GET'],
        statusCodes: [429, 403, 500, 502, 503, 504], // Added 403 for authorization errors
        calculateDelay: ({ error, retryCount }) => {
          // Check Twitter rate limit headers if available
          if (error.response && error.response.headers) {
            const resetTime = error.response.headers['x-rate-limit-reset'];
            if (resetTime) {
              const resetTimestamp = parseInt(resetTime, 10) * 1000; // Convert to milliseconds
              const currentTime = Date.now();
              const waitTime = resetTimestamp - currentTime + 1000; // Add 1 second buffer
              
              if (waitTime > 0) {
                console.log(`⏳ Rate limited. Waiting until reset: ${new Date(resetTimestamp).toLocaleTimeString()}`);
                return waitTime;
              }
            }
          }
          
          // More aggressive backoff for 403 errors
          if (error.response && error.response.statusCode === 403) {
            console.log(`🚫 Got 403 error. Using extended backoff.`);
            return retryCount * 5000; // 5 second, 10 second, 15 second backoff
          }
          
          // Default to exponential backoff
          return Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
        }
      }
    });
    
    // Log rate limit information for debugging
    if (response.headers && response.headers['x-rate-limit-remaining']) {
      const remaining = response.headers['x-rate-limit-remaining'];
      const resetTime = new Date(parseInt(response.headers['x-rate-limit-reset'], 10) * 1000);
      console.log(`📊 Twitter API rate limit: ${remaining} requests remaining`);
      console.log(`⏰ Rate limit resets at: ${resetTime.toLocaleTimeString()}`);
    }
    
    // Check if we have any mentions
    if (!response.body || !response.body.data) {
      if (response.body && response.body.meta && response.body.meta.result_count === 0) {
        console.log('✅ Request successful but no mentions found.');
        return [];
      }
      
      console.warn('⚠️ Unexpected response structure:', JSON.stringify(response.body));
      return [];
    }
    
    console.log(`✅ Successfully fetched ${response.body.data.length} mentions.`);
    return response.body.data;
    
  } catch (error) {
    console.error('❌ Error fetching mentions:');
    
    if (error.response) {
      const statusCode = error.response.statusCode;
      console.error(`   HTTP Status: ${statusCode}`);
      
      if (statusCode === 429) {
        console.error('   Rate limit exceeded. Consider reducing request frequency.');
        if (error.response.headers && error.response.headers['x-rate-limit-reset']) {
          const resetTime = parseInt(error.response.headers['x-rate-limit-reset'], 10) * 1000;
          console.error(`   Rate limit will reset at: ${new Date(resetTime).toLocaleTimeString()}`);
        }
      } else if (statusCode === 403) {
        console.error('   Authentication error (403). Token may be invalid or expired.');
      } 
      
      if (error.response.body) {
        console.error('   API Error Response:', JSON.stringify(error.response.body, null, 2));
      }
    } else {
      console.error(`   ${error.message}`);
    }
    
    console.log('⚠️ Returning empty array due to error');
    return [];
  }
}

/**
 * Fetches user information by user ID
 * @param {string} userId - Twitter user ID to look up
 * @returns {Promise<Object>} - User information including username
 */
export async function getUserById(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  const url = `https://api.twitter.com/2/users/${userId}`;
  
  // Use the same OAuth mechanism as for other API calls
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error('Missing OAuth tokens');
  }
  
  const token = {
    key: tokens.oauth_token,
    secret: tokens.oauth_token_secret,
  };
  
  const authHeader = oauth.toHeader(
    oauth.authorize({
      url,
      method: 'GET'
    }, token)
  );
  
  try {
    const response = await got.get(url, {
      headers: {
        Authorization: authHeader.Authorization,
        'Content-Type': 'application/json'
      },
      responseType: 'json',
      retry: {
        limit: 3,
        methods: ['GET'],
        statusCodes: [429, 403, 500, 502, 503, 504]
      }
    });
    
    return response.body.data;
  } catch (error) {
    console.error(`Error fetching user ${userId}:`, 
      error.response ? error.response.body : error.message);
    throw error;
  }
}