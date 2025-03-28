/**
 * debugAuth.mjs - Diagnose Twitter API authentication issues
 * 
 * This script helps troubleshoot authentication problems by:
 * 1. Checking if tokens exist and are properly formatted
 * 2. Testing API connectivity with the tokens
 * 3. Providing detailed error information
 */
import dotenv from 'dotenv';
dotenv.config();
import got from 'got';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import fs from 'fs/promises';
import { loadTokens } from '../auth.mjs';

// Initialize OAuth 1.0a
const oauth = OAuth({
  consumer: {
    key: process.env.CONSUMER_KEY,
    secret: process.env.CONSUMER_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function: (baseString, key) =>
    crypto.createHmac('sha1', key).update(baseString).digest('base64'),
});

async function checkTokens() {
  console.log('🔍 Checking Twitter API authentication...');
  console.log('\n🔑 CREDENTIALS CHECK:');
  
  // Check environment variables
  console.log(`- CONSUMER_KEY: ${process.env.CONSUMER_KEY ? '✅ Present' : '❌ Missing'}`);
  console.log(`- CONSUMER_SECRET: ${process.env.CONSUMER_SECRET ? '✅ Present' : '❌ Missing'}`);
  console.log(`- TWITTER_USER_ID: ${process.env.TWITTER_USER_ID ? '✅ Present' : '❌ Missing'}`);

  // Check tokens file
  try {
    console.log('\n📄 TOKEN FILE CHECK:');
    const tokens = await loadTokens();
    
    if (!tokens) {
      console.log('❌ No tokens file found or tokens are invalid.');
      console.log('Try running node bot.mjs and authenticating with Twitter.');
      return;
    }
    
    console.log(`- oauth_token: ${tokens.oauth_token ? '✅ Present' : '❌ Missing'}`);
    console.log(`- oauth_token_secret: ${tokens.oauth_token_secret ? '✅ Present' : '❌ Missing'}`);
    console.log(`- user_id: ${tokens.user_id || 'Missing'}`);
    console.log(`- screen_name: ${tokens.screen_name || 'Missing'}`);
    
    // Test a simple API call (get user info)
    console.log('\n🧪 API CONNECTION TEST:');
    const userId = process.env.TWITTER_USER_ID;
    const url = `https://api.twitter.com/2/users/${userId}`;
    
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
      console.log(`Attempting to fetch user profile for ID: ${userId}...`);
      const response = await got.get(url, {
        headers: {
          Authorization: authHeader['Authorization'],
          'User-Agent': 'FantasyTopTwitterBot/1.0'
        },
        responseType: 'json',
        timeout: 10000
      });
      
      console.log('✅ API connection successful!');
      console.log(`Username: ${response.body.data?.username || 'unknown'}`);
      console.log(`Name: ${response.body.data?.name || 'unknown'}`);
      
      // Test mentions endpoint specifically
      await testMentionsEndpoint(tokens, userId);
      
    } catch (error) {
      console.log('❌ API connection failed:');
      console.log(`- Status code: ${error.response?.statusCode}`);
      console.log(`- Error message: ${error.message}`);
      
      if (error.response?.body) {
        console.log(`- API response: ${JSON.stringify(error.response.body)}`);
      }
      
      // Provide potential solutions
      console.log('\n🔧 POTENTIAL SOLUTIONS:');
      console.log('1. Tokens may be expired - try re-authenticating with node bot.mjs (option 7, then restart)');
      console.log('2. Check if your Twitter developer app has the required permissions');
      console.log('3. Make sure your app has Read/Write permissions enabled for account access');
      console.log('4. Verify your API keys are correctly copied into .env file');
    }
    
  } catch (error) {
    console.error('❌ Error checking tokens:', error.message);
  }
}

async function testMentionsEndpoint(tokens, userId) {
  console.log('\n🧪 TESTING MENTIONS ENDPOINT:');
  const url = `https://api.twitter.com/2/users/${userId}/mentions?tweet.fields=created_at&max_results=5`;
  
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
    console.log('Attempting to fetch recent mentions...');
    const response = await got.get(url, {
      headers: {
        Authorization: authHeader['Authorization'],
        'User-Agent': 'FantasyTopTwitterBot/1.0'
      },
      responseType: 'json',
      timeout: 10000
    });
    
    console.log('✅ Mentions API connection successful!');
    const mentionsCount = response.body.meta?.result_count || 0;
    console.log(`Found ${mentionsCount} recent mentions`);
    
    // Show rate limit info if available
    if (response.headers['x-rate-limit-remaining']) {
      console.log(`Rate limit remaining: ${response.headers['x-rate-limit-remaining']}`);
      console.log(`Rate limit resets at: ${new Date(parseInt(response.headers['x-rate-limit-reset'], 10) * 1000).toLocaleTimeString()}`);
    }
    
  } catch (error) {
    console.log('❌ Mentions API connection failed:');
    console.log(`- Status code: ${error.response?.statusCode}`);
    console.log(`- Error message: ${error.message}`);
    
    if (error.response?.body) {
      console.log(`- API response: ${JSON.stringify(error.response.body)}`);
    }
  }
}

// Run the check
checkTokens().catch(console.error);
