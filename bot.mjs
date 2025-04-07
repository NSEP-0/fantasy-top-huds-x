/**
 * bot.mjs - Main entry point for Fantasy Top Twitter bot
 * 
 * This file handles:
 * 1. Twitter authentication
 * 2. Command-line interface for various bot actions
 * 3. Scheduled polling for mentions (when enabled)
 * 4. Manual tweet posting capabilities
 */
import dotenv from 'dotenv';
dotenv.config();
import readline from 'readline';
import { requestToken, accessToken, loadTokens, saveTokens, resetTokensAndState, detectUserIdChange } from './auth.mjs';
import { postTweet } from './twitterClient.mjs';
import { getHeroMarketInfo } from './fantasyService.mjs';
import { processMentions, testProcessMention } from './mentionProcessor.mjs';
import { getStatistics } from './stateManager.mjs';
import { testTwitterPosting } from './utils/debugTools.mjs';

// Setup readline interface for command-line interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Prompts the user for input with the given prompt text
 * @param {string} prompt - The text to display to the user
 * @returns {Promise<string>} - The user's input
 */
function input(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/**
 * Convert wei value to ETH and format as a readable string.
 * Enhanced with better debugging and edge case handling.
 * @param {string|number} weiValue - Value in wei
 * @param {number} decimals - Number of decimal places to display
 * @returns {string} - Formatted ETH value
 */
function formatWeiToEth(weiValue, decimals = 3) {
  console.log(`Formatting wei value: ${weiValue}, type: ${typeof weiValue}`);
  
  // Return 'N/A' if value is falsy (undefined, null, empty string, 0)
  if (!weiValue && weiValue !== 0) {
    console.log('Wei value is falsy, returning N/A');
    return 'N/A';
  }
  
  // Convert to a string if it's not already
  const valueAsString = String(weiValue);
  
  // Validate that it's actually a number
  if (isNaN(Number(valueAsString))) {
    console.warn(`Invalid wei value: ${weiValue}`);
    return 'N/A';
  }
  
  // Handle zero separately to avoid floating point issues
  if (Number(valueAsString) === 0) {
    return '0.000';
  }
  
  // Convert wei to ETH (1 ETH = 10^18 wei)
  const valueInEth = Number(valueAsString) / 1e18;
  console.log(`Converted to ETH: ${valueInEth}`);
  
  // Format to the specified number of decimal places
  return valueInEth.toFixed(decimals);
}

/**
 * Composes and posts a tweet with hero info from Fantasy Top,
 * including detailed market information by rarity.
 *
 * @param {string} heroName - The hero name (or handle) to search for.
 * @param {string|null} replyToTweetId - (Optional) A tweet ID to reply to.
 */
async function postHeroInfoTweet(heroName, replyToTweetId = null) {
  let heroInfo;
  try {
    // Fetch detailed hero market information with raw wei values
    heroInfo = await getHeroMarketInfo(heroName);
    if (!heroInfo) {
      console.error(`No hero found with the name: "${heroName}"`);
      return;
    }
    
    // Debug log the full data structure
    console.log('Hero info received:');
    console.log(JSON.stringify(heroInfo, null, 2));
  } catch (error) {
    console.error(`Error fetching hero info for "${heroName}":`, error);
    return;
  }

  // Construct the tweet text with focused market information
  let message = `${heroInfo.name}\n\n`;
  
  // Add market information for each rarity level - focus on supply, floor price, and last sale
  // Convert the object to an array and sort by rarity (use the rarity key which is 1-4)
  const rarities = Object.values(heroInfo.marketInfo).sort((a, b) => a.rarity - b.rarity);
  
  // Process each rarity level
  rarities.forEach(info => {
    let line = `${info.rarityName}: `;
    
    // Add supply
    if (info.supply !== null && info.supply !== undefined) {
      line += `${info.supply} cards`;
    } else {
      line += `0 cards`;
    }
    
    // Add the key price information
    const marketData = [];
    
    // Debug the raw price values
    console.log(`${info.rarityName} - Raw floor price: ${info.floorPrice}`);
    console.log(`${info.rarityName} - Raw last sell price: ${info.lastSellPrice}`);
    console.log(`${info.rarityName} - Raw highest bid: ${info.highestBid}`);
    
    // 1. Current Price (from getLowestPriceForHeroRarity) - most important
    const formattedFloorPrice = formatWeiToEth(info.floorPrice);
    if (formattedFloorPrice !== 'N/A') {
      marketData.push(`Price: Ξ${formattedFloorPrice}`);
    }
    
    // 2. Last Sell Price (from last_trade)
    const formattedLastSellPrice = formatWeiToEth(info.lastSellPrice);
    if (formattedLastSellPrice !== 'N/A') {
      marketData.push(`Last: Ξ${formattedLastSellPrice}`);
    }
    
    // 3. Highest Bid (optional)
    const formattedHighestBid = formatWeiToEth(info.highestBid);
    if (formattedHighestBid !== 'N/A') {
      marketData.push(`Bid: Ξ${formattedHighestBid}`);
    }
    
    // Only add the parentheses if we have market data
    if (marketData.length > 0) {
      line += ` (${marketData.join(', ')})`;
    }
    
    message += line + '\n';
  });

  // Add a call to action
  message += `\nCheck out more on Fantasy Top!`;
  
  // Debug the final message
  console.log('Final tweet message:');
  console.log(message);

  try {
    const tokens = await loadTokens();
    if (!tokens) {
      console.error('No valid tokens found. Please authenticate first.');
      return;
    }
    console.log('Posting tweet with hero info...');
    console.log(message)
    const response = await postTweet(tokens, message, replyToTweetId);
    console.log('Tweet posted successfully:', response);
  } catch (error) {
    console.error('Error posting tweet:', error);
  }
}

/**
 * Creates a formatted test response for a hero
 * @param {Object} heroInfo - The hero info object
 * @param {string|null} username - Username to include in the mention
 * @returns {string} - Formatted message
 */
function createHeroInfoResponse(heroInfo, username) {
  // Always include username if provided so user gets notified
  let message = username ? `@${username} ` : '';
  message += `Here's the latest for ${heroInfo.name}:\n\n`;
  
  // Only show minimal info for testing
  const rarities = Object.values(heroInfo.marketInfo).sort((a, b) => a.rarity - b.rarity);
  
  // Just first rarity level for test
  if (rarities.length > 0) {
    const info = rarities[0];
    message += `${info.rarityName}: ${info.supply || 0} cards`;
    
    // Add floor price if available
    const formattedFloorPrice = formatWeiToEth(info.floorPrice);
    if (formattedFloorPrice !== 'N/A') {
      message += ` (Price: Ξ${formattedFloorPrice})`;
    }
  }
  
  message += '\n\nCheck out more on Fantasy Top!';
  return message;
}

/**
 * Displays bot statistics to the console
 */
async function showStatistics() {
  console.log('📊 Fetching bot statistics...');
  const stats = await getStatistics();
  
  console.log('\n=== FANTASY TOP BOT STATISTICS ===');
  console.log(`\n🕒 RUNTIME INFO:`);
  console.log(`- Environment: ${stats.runtime.environment}`);
  console.log(`- Node Version: ${stats.runtime.nodeVersion}`);
  console.log(`- Uptime: ${Math.round(stats.uptime / 60)} minutes`);
  
  console.log(`\n🐦 TWITTER ACTIVITY:`);
  console.log(`- Total mentions processed: ${stats.twitter.processedCount}`);
  console.log(`- Last mention ID: ${stats.twitter.lastMentionId || null}`);
  console.log(`- Last processed: ${stats.twitter.lastProcessedAt || 'Never'}`);
  
  console.log(`\n💬 REPLIES:`);
  console.log(`- Total replies sent: ${stats.replies.total}`);
  
  console.log(`\n🦸 TOP HEROES:`);
  const sortedHeroes = Object.entries(stats.replies.byHero)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  if (sortedHeroes.length > 0) {
    sortedHeroes.forEach(([hero, count], idx) => {
      console.log(`${idx+1}. ${hero}: ${count} replies`);
    });
  } else {
    console.log('No hero data available yet');
  }
  
  console.log(`\n🚀 PERFORMANCE:`);
  if (stats.executionMetrics.avgRunDuration) {
    console.log(`- Avg run duration: ${Math.round(stats.executionMetrics.avgRunDuration)}ms`);
    console.log(`- Success rate: ${stats.executionMetrics.successRate.toFixed(1)}%`);
    console.log(`- Total runs: ${stats.executionMetrics.totalRuns}`);
  } else {
    console.log('No performance data available yet');
  }
  
  console.log(`\n❌ ERRORS:`);
  console.log(`- Total errors: ${stats.errors.count}`);
  if (stats.errors.last) {
    console.log(`- Last error: ${stats.errors.last.message}`);
    console.log(`- Context: ${stats.errors.last.context}`);
    console.log(`- Time: ${stats.errors.last.timestamp}`);
  }
  
  console.log('\n=== END STATISTICS ===\n');
}

/**
 * Main entry point: ensures tokens exist, then presents menu of actions
 */
(async () => {
  console.log('🤖 Fantasy Top Twitter Bot Starting...');
  
  // Check for user ID changes between config and tokens
  const userIdMismatch = await detectUserIdChange();
  if (userIdMismatch) {
    console.log('\n⚠️ WARNING: User ID in tokens doesn\'t match .env configuration.');
    console.log('⚠️ Please use option 7 to reset tokens and state, then restart.');
    console.log('⚠️ This prevents state inconsistencies between different Twitter accounts.\n');
  }
  
  console.log('🔑 Attempting to load existing Twitter tokens...');
  
  // Handle authentication - either load existing tokens or start OAuth flow
  let tokens = await loadTokens();
  
  try {
    if (!tokens) {
      console.log('🔄 No tokens found. Starting OAuth authentication flow...');
      
      try {
        const oAuthRequestToken = await requestToken();
        
        console.log('🌐 Please go to the following URL to authorize your app:');
        console.log(`${oAuthRequestToken.authorizeURL}`);
        
        const pin = await input('📌 Enter the PIN provided by Twitter: ');
        
        tokens = await accessToken(oAuthRequestToken, pin.trim());
        await saveTokens(tokens);
        console.log('✅ Authentication successful!');
      } catch (authError) {
        console.error('❌ Authentication failed:', authError.message);
        console.error('Please verify your API keys and try again.');
        
        // Show API key debugging info 
        console.log('\nAPI Key Debug Info:');
        console.log(`- CONSUMER_KEY starts with: ${process.env.CONSUMER_KEY?.substring(0, 5) || 'undefined'}`);
        console.log(`- CONSUMER_SECRET exists: ${Boolean(process.env.CONSUMER_SECRET)}`);
        console.log(`- TWITTER_USER_ID exists: ${Boolean(process.env.TWITTER_USER_ID)}`);
        
        rl.close();
        return;
      }
    }

    // Display menu of available actions
    console.log('\n📋 Available Actions:');
    const menuText = 
      '1. Post example tweet for rasmr\n' +
      '2. Process mentions (rate limited)\n' + 
      '3. Test mention response\n' +
      '4. Test with real tweet text\n' +
      '5. Test reply vs. mention formatting\n' +
      '6. Reset state & process mentions\n' +
      '7. Reset tokens, state & start over\n' +
      '8. Show bot statistics\n' +
      '9. Test reply to all types of mentions\n' +
      '10. Check user ID configuration\n' +
      '11. Debug Twitter posting issues\n';
    
    const action = await input(`${menuText}Enter number: `);
    
    try {
      switch (action.trim()) {
        case '1':
          // Example usage: post hero info for "rasmr"
          console.log('🚀 Posting example hero info tweet...');
          const testHeroName = 'rasmr';
          console.log(`🔍 Fetching data for hero: ${testHeroName}`);
          await postHeroInfoTweet(testHeroName);
          break;
          
        case '2':
          // Process actual mentions
          console.log('🔍 Processing mentions... (Note: This is rate-limited by Twitter)');
          await processMentions();
          console.log('✅ Mention processing complete');
          break;
          
        case '3':
          // Test the mention processing with a simulated tweet
          console.log('🧪 Testing mention processing with simulated tweet...');
          const tweetId = await input('🆔 Enter a tweet ID to reply to (or leave blank for none): ');
          const username = await input('👤 Enter the username that mentioned you: ');
          const tweetText = await input('💬 Enter the tweet text (e.g., "tell me about rasmr"): ') 
                            || 'tell me about rasmr';
          
          await testProcessMention(
            tweetId.trim() || null,
            username.trim() || 'testuser',
            tweetText.trim()
          );
          break;
          
        case '4':
          // Process a real tweet text without hitting the mentions API
          console.log('🧪 Testing with "tell me about rasmr" (no API calls to fetch mentions)');
          await testProcessMention(
            null, // No tweet ID = no actual reply
            'testuser',
            'tell me about rasmr'
          );
          break;
          
        case '5':
          // Test the difference between replies and mentions
          const heroToTest = await input('🔍 Enter hero to test (e.g., "rasmr"): ');
          console.log('🧪 Testing both reply and non-reply formats');
          
          // Get hero info
          const heroInfo = await getHeroMarketInfo(heroToTest);
          if (!heroInfo) {
            console.log(`⚠️ No hero info found for "${heroToTest}"`);
            break;
          }
          
          // Show both versions
          console.log('\nVersion WITH username (direct reply):');
          console.log(createHeroInfoResponse(heroInfo, 'testuser'));
          
          console.log('\nVersion WITHOUT username (mention):');
          console.log(createHeroInfoResponse(heroInfo, null));
          break;
          
        case '6':
          // Reset state and process mentions
          console.log('🧹 Resetting state and processing mentions...');
          await processMentions();
          console.log('✅ State reset and mention processing complete');
          break;
          
        case '7':
          // Reset tokens, state and start over - most aggressive cleanup
          console.log('🧹 Resetting all authentication data and application state...');
          await resetTokensAndState();
          console.log('✅ Reset complete. Please restart the application to perform a fresh authentication.');
          break;
          
        case '8':
          // Show bot statistics
          await showStatistics();
          break;
          
        case '9':
          // Test replying to different types of mentions
          console.log('🧪 Testing bot responses to different mention types');
          const heroToLookup = await input('🔍 Enter hero to lookup (e.g., "rasmr"): ');
          const userToMention = await input('👤 Enter a username to include: ');
          
          console.log(`Looking up hero info for ${heroToLookup}...`);
          const heroData = await getHeroMarketInfo(heroToLookup);
          
          if (!heroData) {
            console.log(`❌ No info found for "${heroToLookup}"`);
            break;
          }
          
          console.log('\n1️⃣ DIRECT REPLY - With username mentioned:');
          const directReply = createHeroInfoResponse(heroData, userToMention);
          console.log(directReply);
          
          console.log('\n2️⃣ WHAT THE BOT DOES NOW - Reply to ALL mentions:');
          console.log('The bot ALWAYS includes the username that mentioned it, regardless of mention type.');
          console.log('This ensures all users get notified when the bot responds to their tweet.');
          console.log(`All responses will start with @${userToMention} to ensure notification.`);
          
          console.log('\nWould you like to post a test tweet about this hero?');
          const shouldPostTest = await input('Post test tweet? (y/n): ');
          
          if (shouldPostTest.toLowerCase() === 'y') {
            await postHeroInfoTweet(heroToLookup);
            console.log('✅ Test tweet posted');
          }
          break;
          
        case '10':
          // Check user ID configuration
          console.log('🔍 Checking User ID Configuration');
          const envUserId = process.env.TWITTER_USER_ID;
          const tokens = await loadTokens();
          
          console.log(`🔹 User ID in .env: ${envUserId || 'Not set'}`);
          if (tokens && tokens.user_id) {
            console.log(`🔹 User ID in tokens: ${tokens.user_id}`);
            console.log(`🔹 Screen name: @${tokens.screen_name || 'unknown'}`);
            
            if (envUserId !== tokens.user_id) {
              console.log('⚠️ MISMATCH DETECTED: User ID in tokens doesn\'t match .env file.');
              
              const shouldReset = await input('Do you want to reset tokens and state for the new user? (y/n): ');
              if (shouldReset.toLowerCase() === 'y') {
                await resetTokensAndState();
                console.log('✅ Reset complete. Please restart the application to authenticate with the new user.');
              } else {
                console.log('❗ User ID mismatch still exists.');
              }
            } else {
              console.log('✅ User ID configuration is consistent.');
            }
          } else {
            console.log('ℹ️ No tokens found. Will authenticate as the user specified in .env when you run the bot.');
          }
          break;

        case '11':
          // Debug Twitter posting issues
          console.log('🔧 Running Twitter Posting Diagnostics');
          const customMessage = await input('Enter a test message (or press Enter for default): ');
          
          console.log('Running diagnostics...');
          const diagResults = await testTwitterPosting(customMessage || undefined);
          
          console.log('\n📊 DIAGNOSTICS RESULTS:');
          console.log(`✅ Success: ${diagResults.success}`);
          
          if (diagResults.errors.length > 0) {
            console.log('\n❌ ERRORS:');
            diagResults.errors.forEach((err, index) => {
              console.log(`\nError ${index+1} in step "${err.step}":`);
              console.log(`- Message: ${err.message}`);
              if (err.statusCode) console.log(`- Status Code: ${err.statusCode}`);
              
              if (err.guidance && err.guidance.length > 0) {
                console.log('\nSuggestions:');
                err.guidance.forEach(tip => console.log(`  ${tip}`));
              }
              
              // Print Twitter error details if available
              if (err.twitterError) {
                console.log('\nTwitter API Error Details:');
                console.log(JSON.stringify(err.twitterError, null, 2));
              }
            });
          }
          
          if (diagResults.diagnostics.recentErrors && diagResults.diagnostics.recentErrors.length > 0) {
            console.log('\n🕒 RECENT POSTING ERRORS:');
            diagResults.diagnostics.recentErrors.forEach((err, index) => {
              console.log(`\n${index+1}. ${new Date(err.timestamp).toLocaleString()}`);
              console.log(`   ${err.message}`);
              console.log(`   Context: ${err.context}`);
            });
          }
          
          console.log('\n📋 RECOMMENDATION:');
          if (diagResults.success) {
            console.log('Twitter posting is working correctly. If you\'re having issues with specific tweets, they may violate Twitter\'s policies or be duplicates.');
          } else {
            console.log('There are issues with Twitter posting. Follow the guidance above to resolve them.');
            console.log('If problems persist, try option 7 to reset tokens and authenticate again.');
          }
          break;
          
        default:
          console.log('⚠️ Invalid option selected');
      }
    } catch (error) {
      console.error('❌ Error processing action:', error.message);
    }
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  } finally {
    rl.close();
  }
})();

// Modify the polling interval to avoid rate limiting
// Poll less frequently - every 15 minutes instead of every minute
const POLLING_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds

// Only start polling if explicitly enabled
const enablePolling = process.env.ENABLE_MENTION_POLLING === 'true';

if (enablePolling) {
  console.log(`Mention polling enabled. Will check every ${POLLING_INTERVAL/60000} minutes.`);
  // For MVP, poll for mentions at a reasonable interval:
  setInterval(() => {
    processMentions().catch(err => console.error('Error processing mentions:', err));
  }, POLLING_INTERVAL);

  // Optionally, you can call processMentions() once at startup:
  console.log('Performing initial mention check...');
  processMentions().catch(err => console.error('Error processing mentions on startup:', err));
} else {
  console.log('Mention polling is disabled. Use manual options to test functionality.');
}
