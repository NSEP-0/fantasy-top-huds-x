// auth.mjs - OAuth authentication module for Twitter API
import dotenv from 'dotenv';
dotenv.config();
import got from 'got';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import fs from 'fs/promises';
import { resetState } from './stateManager.mjs';

// Define Twitter OAuth 1.0a endpoints.
// Reverting to api.twitter.com since the X migration isn't complete on API side
const requestTokenURL = 'https://api.twitter.com/oauth/request_token';
const accessTokenURL = 'https://api.twitter.com/oauth/access_token';
const authorizeURL = 'https://twitter.com/oauth/authorize';

// Track current user to detect account changes
let currentUserId = null;
let configuredUserId = process.env.TWITTER_USER_ID;

// Create an OAuth instance using your consumer keys from your .env file.
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
 * Requests an OAuth request token from Twitter.
 * This is the first step in the 3-legged OAuth flow.
 * 
 * @returns {Promise<Object>} An object containing oauth_token and oauth_token_secret.
 * @throws {Error} If consumer keys are missing or the API request fails
 */
export async function requestToken() {
  if (!process.env.CONSUMER_KEY || !process.env.CONSUMER_SECRET) {
    throw new Error('Missing CONSUMER_KEY or CONSUMER_SECRET in environment variables');
  }

  console.log('🔑 Requesting OAuth request token from Twitter...');
  
  // Request token URL with callback parameter in the query string
  // This was causing the 401 error - Twitter expects callback as a parameter
  const url = `${requestTokenURL}?oauth_callback=oob`;
  
  const authHeader = oauth.toHeader(
    oauth.authorize({
      url,
      method: 'POST',
    })
  );

  try {
    console.log(`Sending request to: ${url}`);
    console.log(`Using consumer key: ${process.env.CONSUMER_KEY.substring(0, 5)}...`);
    
    const response = await got.post(url, {
      headers: { 
        Authorization: authHeader['Authorization'],
        'Content-Length': '0'  // Required for some Twitter API endpoints
      }
    });

    const bodyObj = Object.fromEntries(new URLSearchParams(response.body));
    
    // Better validation and error messages
    if (!bodyObj.oauth_token || !bodyObj.oauth_token_secret) {
      throw new Error('Invalid response: Missing required OAuth tokens');
    }
    
    if (bodyObj.oauth_callback_confirmed !== 'true') {
      throw new Error('OAuth callback not confirmed by Twitter. Please check your app settings.');
    }

    console.log('✅ Request token received successfully.');
    
    // Return authorization URL for convenience
    return {
      oauth_token: bodyObj.oauth_token,
      oauth_token_secret: bodyObj.oauth_token_secret,
      authorizeURL: `${authorizeURL}?oauth_token=${bodyObj.oauth_token}`
    };
  } catch (error) {
    console.error('❌ Error obtaining request token:', error);
    
    // Enhanced error details for easier debugging
    if (error.response) {
      console.error(`Status: ${error.response.statusCode}`);
      console.error('Response body:', error.response.body);
    }
    
    throw error;
  }
}

/**
 * Exchanges a request token and verifier (PIN) for an access token.
 * This is the third step in the 3-legged OAuth flow, after user authorization.
 * 
 * @param {Object} oAuthRequestToken - The object with oauth_token and oauth_token_secret.
 * @param {string} verifier - The PIN provided by Twitter.
 * @returns {Promise<Object>} An object containing access token, token secret, user_id, and screen_name.
 * @throws {Error} If the API request fails
 */
export async function accessToken(oAuthRequestToken, verifier) {
  console.log('🔑 Requesting OAuth access token with PIN:', verifier);

  const authHeader = oauth.toHeader(
    oauth.authorize({
      url: accessTokenURL,
      method: 'POST',
    })
  );

  try {
    const response = await got.post(accessTokenURL, {
      headers: { Authorization: authHeader['Authorization'] },
      form: {
        oauth_token: oAuthRequestToken.oauth_token,
        oauth_verifier: verifier,
      },
    });

    const bodyObj = Object.fromEntries(new URLSearchParams(response.body));
    console.log(`✅ Access tokens received for @${bodyObj.screen_name} (ID: ${bodyObj.user_id})`);
    
    // Check if this is a different user than before
    if (currentUserId && bodyObj.user_id !== currentUserId) {
      console.log(`👤 New user detected (@${bodyObj.screen_name}). Resetting application state...`);
      await resetState();
    }
    
    // Update the current user tracking
    currentUserId = bodyObj.user_id;
    
    return {
      oauth_token: bodyObj.oauth_token,
      oauth_token_secret: bodyObj.oauth_token_secret,
      user_id: bodyObj.user_id,
      screen_name: bodyObj.screen_name,
    };
  } catch (error) {
    console.error('❌ Error obtaining access token:', error.message);
    throw error;
  }
}

/**
 * Saves the provided tokens to a local file (tokens.json).
 * Includes logic to detect user changes and reset state accordingly.
 * 
 * @param {Object} tokens - The tokens object to save.
 */
export async function saveTokens(tokens) {
  console.log('💾 Saving tokens to file...');
  try {
    await fs.writeFile('tokens.json', JSON.stringify(tokens, null, 2));
    
    // Update current user tracking
    if (tokens && tokens.user_id) {
      // Check if this is a different user than before
      if (currentUserId && tokens.user_id !== currentUserId) {
        console.log(`👤 New user detected (@${tokens.screen_name || tokens.user_id}). Resetting application state...`);
        await resetState();
      }
      
      currentUserId = tokens.user_id;
    }
    
    console.log('✅ Tokens saved successfully.');
  } catch (error) {
    console.error('❌ Error saving tokens:', error.message);
  }
}

/**
 * Loads tokens from the local tokens.json file, if available.
 * Includes logic to detect user changes and reset state accordingly.
 * 
 * @returns {Promise<Object|null>} The tokens object if found, or null if not.
 */
export async function loadTokens() {
  try {
    const data = await fs.readFile('tokens.json', 'utf-8');
    const tokens = JSON.parse(data);
    
    // Check if env config user ID changed
    if (configuredUserId !== process.env.TWITTER_USER_ID) {
      console.log('🔄 Environment TWITTER_USER_ID changed! Updating configuration...');
      configuredUserId = process.env.TWITTER_USER_ID;
    }
    
    // Update current user tracking
    if (tokens && tokens.user_id) {
      // Check if this is a different user than before OR different from .env config
      if ((currentUserId && tokens.user_id !== currentUserId) || 
          (configuredUserId && tokens.user_id !== configuredUserId)) {
        console.log(`👤 Different user detected (@${tokens.screen_name || tokens.user_id}).`);
        console.log(`👤 Current configured user ID: ${configuredUserId}`);
        console.log(`👤 Token user ID: ${tokens.user_id}`);
        
        // If user in token doesn't match .env config, we need to get new tokens
        if (configuredUserId && tokens.user_id !== configuredUserId) {
          console.log('⚠️ Token user doesn\'t match configured user in .env');
          console.log('⚠️ Tokens will be reset on next authentication flow');
          return null; // Force re-authentication
        }
        
        // Otherwise it's just a normal user change in the same session
        console.log(`👤 Resetting application state for new user...`);
        await resetState();
      }
      
      currentUserId = tokens.user_id;
    }
    
    console.log(`🔑 Loaded tokens for @${tokens.screen_name || tokens.user_id || 'unknown'}`);
    return tokens;
  } catch (error) {
    console.warn('⚠️ No tokens found or tokens file is invalid. Starting fresh.');
    return null;
  }
}

/**
 * Resets tokens and state - useful when switching users or clearing auth data
 * @returns {Promise<boolean>} True if reset was successful, false otherwise
 */
export async function resetTokensAndState() {
  try {
    // Replace with empty tokens file
    await fs.writeFile('tokens.json', JSON.stringify({}, null, 2));
    
    // Reset application state
    await resetState();
    
    // Reset current user tracking
    currentUserId = null;
    
    console.log('🧹 Authentication and state data have been reset.');
    return true;
  } catch (error) {
    console.error('❌ Error resetting tokens and state:', error.message);
    return false;
  }
}

/**
 * Reloads and refreshes tokens if possible
 * This can help fix stale tokens issues
 * @returns {Promise<Object|null>} The refreshed tokens or null if unsuccessful
 */
export async function refreshTokens() {
  try {
    console.log('🔄 Attempting to refresh Twitter tokens...');
    
    // For OAuth 1.0a, we can't truly refresh without user interaction
    // But we can check if the tokens file was modified and reload
    const tokens = await loadTokens();
    
    if (!tokens) {
      console.error('❌ No tokens found to refresh');
      return null;
    }
    
    // Test if tokens are valid with a simple API call
    const testUrl = `https://api.twitter.com/2/users/${tokens.user_id}`;
    
    const token = {
      key: tokens.oauth_token,
      secret: tokens.oauth_token_secret,
    };
    
    const authHeader = oauth.toHeader(
      oauth.authorize({
        url: testUrl,
        method: 'GET'
      }, token)
    );
    
    try {
      const response = await got.get(testUrl, {
        headers: {
          Authorization: authHeader['Authorization'],
          'Content-Type': 'application/json',
          'User-Agent': 'FantasyTopTwitterBot/1.0'
        },
        responseType: 'json'
      });
      
      console.log('✅ Tokens are valid');
      return tokens;
    } catch (error) {
      console.error('❌ Tokens appear to be invalid or expired:', error.message);
      return null;
    }
  } catch (error) {
    console.error('❌ Error refreshing tokens:', error.message);
    return null;
  }
}

/**
 * Called at startup to check if user ID in configuration matches the tokens
 * @returns {Promise<boolean>} True if user ID mismatch detected and action required
 */
export async function detectUserIdChange() {
  try {
    const tokens = await loadTokens();
    if (!tokens) return false; // No tokens = no mismatch
    
    // If there's a mismatch between tokens user and configured user
    if (tokens.user_id && configuredUserId && 
        tokens.user_id !== configuredUserId) {
      console.log('⚠️ USER ID MISMATCH DETECTED:');
      console.log(`🔹 Configured user ID: ${configuredUserId}`);
      console.log(`🔹 Token user ID: ${tokens.user_id}`);
      console.log('⚠️ You should reset tokens and state (menu option 7) and restart the bot');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking user ID change:', error.message);
    return false;
  }
}
