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
 * @param {Object} options - Options for fetching mentions
 * @returns {Promise<Array>} - An array of mention tweets or empty array if none
 */
export async function getMentions(options = {}) {
  try {
    console.log(`🔍 Fetching mentions for user ID: ${process.env.TWITTER_USER_ID}...`);
    
    // Load authentication tokens
    console.log('🔑 Loading authentication tokens...');
    const tokens = await loadTokens();
    if (!tokens) {
      throw new Error('No authentication tokens available');
    }
    console.log(`🔑 Loaded tokens for @${tokens.screen_name}`);

    // Either use sinceId or calculate start_time
    let queryParams = {};
    
    if (options.sinceId) {
      console.log(`🔍 Using since_id filtering with ID: ${options.sinceId}`);
      queryParams.since_id = options.sinceId;
    } else if (options.minutesAgo) {
      const minutesAgo = options.minutesAgo;
      console.log(`⏰ Time range filter: Last ${minutesAgo} minutes`);
      
      // Calculate start_time
      const now = new Date();
      console.log(`Current time (local): ${now.toLocaleString()}`);
      console.log(`Current time (UTC): ${now.toUTCString()}`);
      
      const startTime = new Date(now.getTime() - minutesAgo * 60 * 1000);
      console.log(`Start time (local): ${startTime.toLocaleString()}`);
      console.log(`Start time (UTC): ${startTime.toUTCString()}`);
      
      // Format for Twitter API - YYYY-MM-DDTHH:mm:ssZ
      // Manually format to ensure exact compliance with Twitter's requirements
      const year = startTime.getUTCFullYear();
      const month = String(startTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(startTime.getUTCDate()).padStart(2, '0');
      const hours = String(startTime.getUTCHours()).padStart(2, '0');
      const minutes = String(startTime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(startTime.getUTCSeconds()).padStart(2, '0');
      
      const formattedStartTime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
      console.log(`📅 Twitter API start_time format: ${formattedStartTime}`);
      
      queryParams.start_time = formattedStartTime;
      
      // Validate the format with a regex test
      const isCorrectFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(formattedStartTime);
      console.log(`Is format valid for Twitter API? ${isCorrectFormat ? 'Yes' : 'No'}`);
    }
    
    // Add necessary fields
    queryParams['tweet.fields'] = 'created_at,entities,author_id,in_reply_to_user_id';
    queryParams['expansions'] = 'author_id';
    
    // Create final URL with all parameters
    const userId = process.env.TWITTER_USER_ID;
    const baseUrl = `https://api.twitter.com/2/users/${userId}/mentions`;
    const queryString = Object.entries(queryParams)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    const fullUrl = `${baseUrl}?${queryString}`;
    
    console.log(`🔗 Full Twitter API request URL: ${fullUrl}`);
    
    // Send the request
    console.log('📡 Sending request to Twitter API...');
    const response = await sendTwitterRequest({
      method: 'GET',
      url: fullUrl,
      tokens
    });
    
    // Process and return the results
    if (response && response.data) {
      console.log(`📊 Found ${response.data.length} mentions`);
      return response.data;
    }
    
    return [];
  } catch (error) {
    console.error('❌ Error fetching mentions:');
    console.error(`   HTTP Status: ${error.statusCode || 'Unknown'}`);
    console.error(`   ${error.message}`);
    
    if (error.message.includes('401')) {
      console.error('   Authentication error (401): Your tokens appear to be invalid or expired.');
      console.error('   ACTION REQUIRED: Please reset tokens and re-authenticate.');
    } else if (error.message.includes('429')) {
      console.error('   Rate limit error (429): You\'ve exceeded Twitter API rate limits.');
      console.error('   ACTION REQUIRED: Wait a few minutes before trying again.');
    }
    
    console.error('   API Error Response:', error.twitterError ? 
      JSON.stringify(error.twitterError, null, 2) : 'No detailed error info');
    
    console.warn('⚠️ Returning empty array due to error');
    return [];
  }
}

/**
 * Send a request to the Twitter API with proper OAuth authentication
 * @param {Object} options - Request options
 * @returns {Promise<Object>} - Twitter API response
 */
async function sendTwitterRequest(options) {
  const { method, url, tokens, body } = options;
  
  const token = {
    key: tokens.oauth_token,
    secret: tokens.oauth_token_secret,
  };
  
  const authHeader = oauth.toHeader(
    oauth.authorize(
      {
        url,
        method,
      },
      token
    )
  );
  
  try {
    const requestOptions = {
      headers: {
        Authorization: authHeader.Authorization,
        'User-Agent': 'FantasyTopTwitterBot',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      responseType: 'json',
    };
    
    if (body) {
      requestOptions.json = body;
    }
    
    console.log(`Sending ${method} request to: ${url}`);
    const response = method === 'GET' 
      ? await got.get(url, requestOptions)
      : await got.post(url, requestOptions);
    
    return response.body;
  } catch (error) {
    const enhancedError = new Error(error.message);
    enhancedError.statusCode = error.response?.statusCode;
    enhancedError.twitterError = error.response?.body;
    enhancedError.isTwitterError = true;
    throw enhancedError;
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