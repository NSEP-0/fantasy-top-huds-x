// auth.mjs
import dotenv from 'dotenv';
dotenv.config();
import got from 'got';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import fs from 'fs/promises';

// Define Twitter OAuth 1.0a endpoints.
const requestTokenURL =
  'https://api.twitter.com/oauth/request_token?oauth_callback=oob&x_auth_access_type=write';
const accessTokenURL = 'https://api.twitter.com/oauth/access_token';

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
 * @returns {Promise<Object>} An object containing oauth_token and oauth_token_secret.
 */
export async function requestToken() {
  if (!process.env.CONSUMER_KEY || !process.env.CONSUMER_SECRET) {
    throw new Error('Missing CONSUMER_KEY or CONSUMER_SECRET in environment variables');
  }

  console.log('Requesting OAuth request token.');
  const authHeader = oauth.toHeader(
    oauth.authorize({
      url: requestTokenURL,
      method: 'POST',
    })
  );

  try {
    const response = await got.post(requestTokenURL, {
      headers: { Authorization: authHeader['Authorization'] },
    });

    const bodyObj = Object.fromEntries(new URLSearchParams(response.body));
    if (bodyObj.oauth_callback_confirmed !== 'true') {
      throw new Error('OAuth callback not confirmed.');
    }

    console.log('Request token received:', bodyObj);
    return {
      oauth_token: bodyObj.oauth_token,
      oauth_token_secret: bodyObj.oauth_token_secret,
    };
  } catch (error) {
    console.error('Error obtaining request token:', error);
    throw error;
  }
}

/**
 * Exchanges a request token and verifier (PIN) for an access token.
 * @param {Object} oAuthRequestToken - The object with oauth_token and oauth_token_secret.
 * @param {string} verifier - The PIN provided by Twitter.
 * @returns {Promise<Object>} An object containing the access token, token secret, user_id, and screen_name.
 */
export async function accessToken(oAuthRequestToken, verifier) {
  console.log('Requesting OAuth access token with verifier:', verifier);

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
    console.log('Access tokens received:', bodyObj);
    return {
      oauth_token: bodyObj.oauth_token,
      oauth_token_secret: bodyObj.oauth_token_secret,
      user_id: bodyObj.user_id,
      screen_name: bodyObj.screen_name,
    };
  } catch (error) {
    console.error('Error obtaining access token:', error);
    throw error;
  }
}

/**
 * Saves the provided tokens to a local file (tokens.json).
 * @param {Object} tokens - The tokens object to save.
 */
export async function saveTokens(tokens) {
  console.log('Saving tokens to file:', tokens);
  try {
    await fs.writeFile('tokens.json', JSON.stringify(tokens, null, 2));
    console.log('Tokens saved successfully.');
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

/**
 * Loads tokens from the local tokens.json file, if available.
 * @returns {Promise<Object|null>} The tokens object if found, or null if not.
 */
export async function loadTokens() {
  try {
    const data = await fs.readFile('tokens.json', 'utf-8');
    console.log('Loaded tokens successfully:', data);
    return JSON.parse(data);
  } catch (error) {
    console.warn('No tokens found. Starting fresh.');
    return null;
  }
}
