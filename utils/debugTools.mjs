/**
 * Debugging tools for Twitter errors and API issues
 */
import { loadTokens } from '../auth.mjs';
import { postTweet } from '../twitterClient.mjs';
import { getStatistics } from '../stateManager.mjs';

/**
 * Tests Twitter posting and provides detailed diagnostics of any errors
 * @param {string} message - Test message to post
 * @returns {Promise<Object>} - Result object with success status and details
 */
export async function testTwitterPosting(message = 'Test tweet from debugging tool') {
  console.log('🔍 Testing Twitter API posting...');
  
  const result = {
    success: false,
    timestamp: new Date().toISOString(),
    message: message,
    errors: [],
    diagnostics: {}
  };
  
  try {
    // Step 1: Load tokens and check they exist
    console.log('Step 1: Loading authentication tokens...');
    const tokens = await loadTokens();
    
    if (!tokens) {
      result.errors.push({
        step: 'authentication',
        error: 'No tokens found',
        hint: 'Run the bot and authenticate with Twitter'
      });
      return result;
    }
    
    result.diagnostics.tokenInfo = {
      hasOAuthToken: Boolean(tokens.oauth_token),
      hasTokenSecret: Boolean(tokens.oauth_token_secret),
      userId: tokens.user_id,
      screenName: tokens.screen_name
    };
    
    console.log(`Using tokens for @${tokens.screen_name || 'unknown'}`);
    
    // Step 2: Try posting a test tweet
    console.log('Step 2: Attempting to post test tweet...');
    try {
      const response = await postTweet(tokens, message);
      console.log('Tweet posted successfully!');
      
      result.success = true;
      result.diagnostics.tweetId = response?.data?.id;
      result.diagnostics.response = response;
      
    } catch (error) {
      result.success = false;
      
      const errorInfo = {
        message: error.message,
        statusCode: error.statusCode || null,
      };
      
      // Add Twitter-specific error info if available
      if (error.twitterError) {
        errorInfo.twitterError = error.twitterError;
      }
      
      // Add guidance based on error type
      if (error.statusCode === 403) {
        errorInfo.guidance = [
          '1. Check if your Twitter developer app has write permissions',
          '2. Verify you\'re not posting duplicate content',
          '3. Ensure your app hasn\'t been restricted by Twitter'
        ];
      } else if (error.statusCode === 401) {
        errorInfo.guidance = [
          '1. Your tokens may be expired - try re-authenticating',
          '2. Check if you\'ve revoked app access on Twitter'
        ];
      }
      
      result.errors.push({
        step: 'posting',
        ...errorInfo
      });
    }
    
    // Step 3: Get and include recent error statistics
    console.log('Step 3: Gathering error statistics...');
    const stats = await getStatistics();
    
    result.diagnostics.recentErrors = stats.errors.history
      .filter(e => e.context && e.context.includes('post reply'))
      .slice(0, 5)
      .map(e => ({
        timestamp: e.timestamp,
        message: e.message,
        context: e.context
      }));
    
    return result;
    
  } catch (error) {
    console.error('Error running Twitter diagnosis:', error);
    result.errors.push({
      step: 'diagnosis',
      error: error.message
    });
    return result;
  }
}

/**
 * Checks Twitter post permission status
 * @returns {Promise<Object>} - Results of permission checks
 */
export async function checkTwitterPermissions() {
  // Implementation to check app permissions could go here
  // This would require additional API calls
  return { implemented: false };
}
