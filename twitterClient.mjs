// twitterClient.mjs
import got from 'got';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

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
    console.error(
      'Error posting tweet:',
      error.response ? error.response.body : error.message
    );
    throw error;
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
