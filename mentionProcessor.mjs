import { getMentions, getUserById } from './twitterClient.mjs';
import { getHeroMarketInfo } from './fantasyService.mjs';
import { postTweet } from './twitterClient.mjs';
import { loadTokens } from './auth.mjs';
import { 
  loadLastMentionId, 
  saveLastMentionId, 
  hasRepliedToTweet, 
  markTweetAsReplied,
  startExecution,
  endExecution,
  recordError
} from './stateManager.mjs';
import { extractPotentialHeroes } from './utils/heroExtractor.mjs';
import { formatWeiToEth } from './utils/formatters.mjs';
import readline from 'readline';
// Import new mention helper functions
import {
  getMentionType,
  extractUserInfo,
  shouldRespondToMention,
  formatReplyText
} from './mentionHelper.mjs';

// Maximum age for tweets to process (15 minutes in milliseconds)
const MAX_TWEET_AGE_MS = 900000;

// Get the bot's username from environment variable or use default
const BOT_USERNAME = process.env.TWITTER_USERNAME || 'FantasyTopHuds';
const BOT_USER_ID = process.env.TWITTER_USER_ID;

/**
 * Creates a formatted tweet with hero market info
 * Always includes @username for all responses so the user gets a notification
 * 
 * @param {Object} heroInfo - The hero information object
 * @param {string|null} username - Username to mention in the reply
 * @returns {Object} - Formatted tweet content object
 */
function createHeroInfoResponse(heroInfo, username) {
  // Maximum tweet length allowed by Twitter
  const MAX_TWEET_LENGTH = 280;
  
  // Call to action text that we'll add if there's room
  const CALL_TO_ACTION = "\nCheck out more on Fantasy Top!";
  
  // Always include username if provided (whether direct reply or not)
  // This ensures the user gets notified when we respond
  let message = username ? `@${username} ` : '';
  message += `Here's the latest for ${heroInfo.name}:\n\n`;
  
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

  // Add a call to action only if it fits within the character limit
  if (message.length + CALL_TO_ACTION.length <= MAX_TWEET_LENGTH) {
    message += CALL_TO_ACTION;
  } else {
    // Log that we're omitting the call to action due to length constraints
    console.log(`⚠️ Tweet is too long (${message.length} chars), omitting call to action`);
    
    // If the message is still too long, truncate it with an ellipsis
    if (message.length > MAX_TWEET_LENGTH) {
      message = message.substring(0, MAX_TWEET_LENGTH - 3) + '...';
      console.log(`⚠️ Tweet truncated to ${message.length} characters`);
    }
  }
  
  // Log the final tweet length
  console.log(`📏 Final tweet length: ${message.length}/${MAX_TWEET_LENGTH} characters`);
  
  return {
    text: message,
    heroName: heroInfo.name
  };
}

/**
 * Checks if a tweet is recent enough to process
 * @param {string} tweetCreatedAt - ISO timestamp from Twitter
 * @returns {boolean} - True if tweet is recent enough to process
 */
function isTweetRecent(tweetCreatedAt) {
  if (!tweetCreatedAt) return false;
  
  const tweetDate = new Date(tweetCreatedAt);
  const now = new Date();
  const ageMs = now - tweetDate;
  
  const isRecent = ageMs <= MAX_TWEET_AGE_MS;
  if (!isRecent) {
    console.log(`Tweet from ${tweetDate.toLocaleString()} is too old (${Math.round(ageMs/1000/60)} minutes)`);
  } else {
    console.log(`Tweet from ${tweetDate.toLocaleString()} is recent (${Math.round(ageMs/1000/60)} minutes old)`);
  }
  
  return isRecent;
}

/**
 * Checks if a tweet is a reply to any user (as opposed to an original tweet)
 * This is for logging purposes only - we process ALL mentions regardless
 * @param {Object} mention - The mention object from Twitter
 * @returns {boolean} - True if it's a reply to any user
 */
function isDirectReply(mention) {
  // Check if in_reply_to_user_id exists in the mention object
  // If it exists, it means this tweet is a reply to someone
  return mention.in_reply_to_user_id !== undefined && mention.in_reply_to_user_id !== null;
}

/**
 * Sleep/delay function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Processes incoming mentions:
 * - Fetches new mentions since the last processed ID or from the last X minutes
 * - Uses entity annotations to identify heroes when available
 * - Replies to ALL tweets that mention the bot (not just direct replies)
 * - Responds with hero information if a valid hero is found
 */
export async function processMentions() {
  const executionId = await startExecution();
  const stats = {
    mentionsFound: 0,
    mentionsProcessed: 0,
    repliesSent: 0,
    errors: 0,
    retries: 0
  };
  
  try {
    console.log('🔍 Processing mentions...');
    // Load last processed tweet ID
    const lastMentionId = await loadLastMentionId();
    console.log(`📜 Last processed mention ID: ${lastMentionId || 'None'}`);
    
    // Fetch mentions, use either lastMentionId or time-based filtering
    const fetchOptions = {};
    if (lastMentionId) {
      console.log(`📊 Using lastMentionId for filtering: ${lastMentionId}`);
      fetchOptions.sinceId = lastMentionId;
    } else {
      // If we don't have a lastMentionId, fetch mentions from last X minutes
      const minutesAgo = MAX_TWEET_AGE_MS / 60000;
      console.log(`⏰ No lastMentionId found. Using time range filter: Last ${minutesAgo} minutes`);
      fetchOptions.minutesAgo = minutesAgo;
      
      // Convert to a date for logging purposes
      const startTime = new Date(new Date().getTime() - MAX_TWEET_AGE_MS);
      console.log(`📅 Twitter API start_time format: ${startTime.toISOString().replace(/\.\d{3}Z$/, 'Z')}`);
    }
    
    // Debug what we're requesting
    console.log(`📤 Fetch options: ${JSON.stringify(fetchOptions, null, 2)}`);
    
    const mentions = await getMentions(fetchOptions);
    stats.mentionsFound = mentions.length;
    console.log(`📊 Found ${mentions.length} new mentions`);
    
    // Process mentions in chronological order (oldest first)
    mentions.sort((a, b) => (a.id > b.id ? 1 : -1));
    for (const mention of mentions) {
      try {
        console.log(`🔍 Processing mention ID: ${mention.id} from author_id: ${mention.author_id}`);
        stats.mentionsProcessed++;
        
        // Skip if we've already replied to this tweet
        if (await hasRepliedToTweet(mention.id)) {
          console.log(`⏭️ Already replied to tweet ${mention.id}, skipping`);
          continue;
        }
        
        // Skip if the tweet is older than our maximum age setting
        if (!isTweetRecent(mention.created_at)) {
          console.log(`Tweet ${mention.id} is too old, skipping`);
          // Still mark as processed so we don't check it again
          await saveLastMentionId(mention.id);
          continue;
        }

        // Determine if this is a direct or indirect mention
        const mentionType = getMentionType(mention, BOT_USERNAME);
        console.log(`Mention type: ${mentionType.isDirect ? 'Direct' : 'Indirect'} mention at position ${mentionType.mentionPosition}`);
        
        // Skip if we shouldn't respond to this mention
        if (!shouldRespondToMention(mention, mentionType, BOT_USER_ID)) {
          console.log(`Skipping tweet ${mention.id} - not a valid mention to respond to`);
          await saveLastMentionId(mention.id);
          continue;
        }
        
        const text = mentionType.cleanedText || mention.text;
        const entities = mention.entities || {};
        
        // Extract candidate heroes using the heroes database AND Twitter annotations
        const candidateHeroes = await extractPotentialHeroes(text, entities);
        if (candidateHeroes.length === 0) {
          console.log(`No candidate heroes found in tweet ${mention.id}`);
          // Update the last mention ID and continue
          await saveLastMentionId(mention.id);
          continue;
        }
        
        console.log(`Candidate heroes: ${candidateHeroes.join(', ')}`);
        let heroFound = null;
        // Iterate over candidates and query the Fantasy Top API until one returns a valid hero.
        for (const candidate of candidateHeroes) {
          try {
            console.log(`Trying candidate: "${candidate}"`);
            const heroInfo = await getHeroMarketInfo(candidate);
            if (heroInfo) {
              heroFound = heroInfo;
              console.log(`Found hero info for candidate "${candidate}": ${heroInfo.name}`);
              break;
            }
          } catch (err) {
            if (err.message.includes('rate limit') || err.message.includes('too many requests')) {
              console.warn(`Rate limit hit when processing "${candidate}". Will retry later.`);
              // Don't continue processing this mention to avoid more rate limit issues
              // We won't update lastMentionId so we'll retry this mention later
              return;
            } else {
              console.error(`Error processing candidate "${candidate}":`, err.message);
            }
          }
        }
        
        // If a hero is found, reply to the tweet (regardless of whether it's a direct reply or not)
        if (heroFound) {
          const tokens = await loadTokens();
          if (!tokens) {
            console.error('No valid tokens found. Cannot reply to mention.');
            const noTokensError = new Error('No valid tokens found for Twitter API');
            await recordError(noTokensError, `Failed to post reply to ${mention.id}`);
            stats.errors++;
            continue;
          }

          // Get the username for the reply - use author_id (the tweet creator)
          // This ensures we always notify the user who mentioned us
          let username = mention.username;
          
          if (!username && mention.author_id) {
            try {
              console.log(`Fetching username for author_id: ${mention.author_id}`);
              const userData = await getUserById(mention.author_id);
              username = userData?.username;
              console.log(`Fetched username for author_id ${mention.author_id}: ${username}`);
            } catch (error) {
              console.error(`Failed to get username for author_id ${mention.author_id}:`, error.message);
              // Don't record this as an error in the state, just log to console
              // This is a known issue with the Twitter API rate limits
              stats.errors++; // Still count it in stats but don't log to state
            }
          }

          // Extract user info
          const userInfo = {
            authorId: mention.author_id,
            authorUsername: username,
            authorDisplayName: null
          };

          // Create hero response and format based on mention type
          const heroResponse = createHeroInfoResponse(heroFound, username);
          
          // Format the reply text based on mention type
          const replyText = formatReplyText(heroResponse, mentionType, userInfo);
          
          console.log('Replying with:', replyText);
          
          let replySuccess = false;
          let retryCount = 0;
          const MAX_RETRIES = 0; // Set to 0 for no retries
          
          while (!replySuccess && retryCount <= MAX_RETRIES) {
            try {
              if (retryCount > 0) {
                const delay = retryCount * 10000; // Increase delay with each retry (10s, 20s, 30s)
                console.log(`⏳ Retry ${retryCount}/${MAX_RETRIES} - Waiting ${delay/1000}s before retrying...`);
                await sleep(delay);
                console.log(`🔄 Retrying tweet post to ${mention.id}...`);
                stats.retries++;
              }
              
              await postTweet(tokens, replyText, mention.id);
              console.log(`Replied to mention ID: ${mention.id}`);
              replySuccess = true;
              stats.repliesSent++;
              
              // Mark this tweet as replied to
              await markTweetAsReplied(mention.id, {
                heroName: heroFound.name,
                authorUsername: username || mention.author_id,
                replyText: replyText.substring(90, 150) + '...' || '', // Store preview of reply
                mentionType: mentionType.isDirect ? 'direct' : 'indirect'
              });
            } catch (error) {
              // Determine if we should retry
              const shouldRetry = 
                error.isTwitterError && 
                error.statusCode === 403 && 
                (error.message.includes('not permitted to perform this action') ||
                 (error.twitterError?.detail?.includes('not permitted to perform this action')));
                
              if (shouldRetry && retryCount < MAX_RETRIES) {
                // We'll retry - increment the counter and continue loop
                retryCount++;
                console.log(`⚠️ Received Twitter 403 error - may be posting too quickly. Will retry.`);
              } else {
                // We've either exhausted retries or it's another type of error
                stats.errors++;
                
                // Create a descriptive error message
                const errorContext = `Failed to post reply to tweet ${mention.id}`;
                let errorDetails = '';
                
                if (error.isTwitterError) {
                  // Format Twitter API errors with more context
                  errorDetails = `Twitter API error (${error.statusCode}): `;
                  
                  if (error.twitterError) {
                    if (error.twitterError.detail) {
                      errorDetails += error.twitterError.detail;
                    }
                    if (error.twitterError.title) {
                      errorDetails += ` (${error.twitterError.title})`;
                    }
                  } else {
                    errorDetails += error.message;
                  }
                  
                  // Add hints for common errors
                  if (error.statusCode === 403) {
                    console.error(`🚫 Permission error (403) when posting tweet. Check app permissions and duplicate content.`);
                  } else if (error.statusCode === 401) {
                    console.error(`🔐 Authentication error (401). Tokens may be expired. Try resetting authentication.`);
                  }
                } else {
                  // General error
                  errorDetails = error.message;
                }
                
                console.error(`Error posting reply: ${errorDetails}`);
                
                // Record this error in our state
                await recordError(error, errorContext);
                
                // Break the retry loop
                break;
              }
            }
          }
          
          // Always update lastMentionId, even if reply failed
          await saveLastMentionId(mention.id);
        } else {
          console.log(`No valid hero found in mention ID: ${mention.id}`);
          await saveLastMentionId(mention.id);
        }
      } catch (mentionError) {
        stats.errors++;
        await recordError(mentionError, `Processing mention ID: ${mention.id}`);
        console.error(`❌ Error processing mention ${mention.id}:`, mentionError);
      }
    }
    
    await endExecution(true, stats);
    return stats;
  } catch (error) {
    console.error('❌ Error in processMentions:', error);
    await recordError(error, 'processMentions');
    await endExecution(false, { ...stats, errors: stats.errors + 1 });
    throw error;
  }
}

/**
 * Test function to simulate processing a mention
 * Updated to use the same hero extraction logic as processMentions
 */
export async function testProcessMention(tweetId, username, tweetText) {
  console.log(`Testing mention processing with simulated tweet: "${tweetText}"`);
  
  // Create simulated tweet for mention type detection
  const simulatedTweet = {
    id: tweetId || 'simulated_12345',
    text: tweetText,
    author_id: 'simulated_user_id'
  };
  
  // Determine mention type
  const mentionType = getMentionType(simulatedTweet, BOT_USERNAME);
  console.log(`Mention type: ${mentionType.isDirect ? 'Direct' : 'Indirect'} mention at position ${mentionType.mentionPosition}`);
  
  // Create user info
  const userInfo = {
    authorId: 'simulated_user_id',
    authorUsername: username,
    authorDisplayName: 'Test User'
  };
  
  // Extract candidate heroes using the heroes database
  const candidateHeroes = await extractPotentialHeroes(mentionType.cleanedText || tweetText);
  if (candidateHeroes.length === 0) {
    console.log(`No candidate heroes found in tweet text`);
    return;
  }
  
  console.log(`Candidate heroes: ${candidateHeroes.join(', ')}`);
  let heroFound = null;
  // Iterate over candidates and query the Fantasy Top API until one returns a valid hero.
  for (const candidate of candidateHeroes) {
    try {
      console.log(`Trying candidate: "${candidate}"`);
      const heroInfo = await getHeroMarketInfo(candidate);
      if (heroInfo) {
        heroFound = heroInfo;
        console.log(`Found hero info for candidate "${candidate}": ${heroInfo.name}`);
        break;
      }
    } catch (err) {
      console.error(`Error processing candidate "${candidate}":`, err.message);
    }
  }
  
  // If a hero is found, create the reply
  if (heroFound) {
    const tokens = await loadTokens();
    if (!tokens) {
      console.error('No valid tokens found. Cannot reply to mention.');
      return;
    }
    
    // Create a properly formatted response with hero market details
    const heroResponse = createHeroInfoResponse(heroFound, username);
    const replyText = formatReplyText(heroResponse, mentionType, userInfo);
    
    console.log('Would reply with:');
    console.log(replyText);
    
    const shouldPost = await new Promise(resolve => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('Do you want to actually post this reply? (yes/no): ', answer => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      });
    });
    
    if (shouldPost) {
      try {
        await postTweet(tokens, replyText, tweetId);
        console.log(`Posted reply to tweet ID: ${tweetId}`);
      } catch (error) {
        console.error('Error posting reply:', error.message);
      }
    } else {
      console.log('Reply not posted (dry run)');
    }
  } else {
    console.log(`No valid hero found in tweet text: "${tweetText}"`);
  }
}
