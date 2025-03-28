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

// Maximum age for tweets to process (60 minutes in milliseconds)
const MAX_TWEET_AGE_MS = 4000000;

/**
 * Creates a formatted tweet with hero market info
 * Always includes @username for all responses so the user gets a notification
 * 
 * @param {Object} heroInfo - The hero information object
 * @param {string|null} username - Username to mention in the reply
 * @returns {string} - Formatted tweet text
 */
function createHeroInfoResponse(heroInfo, username) {
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

  // Add a call to action
  message += `\nCheck out more on Fantasy Top!`;
  
  return message;
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
    errors: 0
  };
  
  try {
    console.log('🔍 Processing mentions...');
    // Load last processed tweet ID
    const lastMentionId = await loadLastMentionId();
    console.log(`📜 Last processed mention ID: ${lastMentionId || 'None'}`);
    
    // Fetch mentions, use either lastMentionId or time-based filtering
    const fetchOptions = {};
    if (lastMentionId) {
      fetchOptions.sinceId = lastMentionId;
    } else {
      // If we don't have a lastMentionId, fetch mentions from last X minutes
      fetchOptions.minutesAgo = MAX_TWEET_AGE_MS / 60000;
    }
    
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
        
        const text = mention.text;
        const entities = mention.entities || {};
        
        // Log whether this is a direct reply - but process ALL mentions regardless
        const isReply = isDirectReply(mention);
        console.log(`Is direct reply to another user: ${isReply} (Note: Processing ALL mentions)`);
        
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
              // Record error but continue without username - will just post without the @username mention
              await recordError(error, `Failed to get username for author_id ${mention.author_id}`);
              stats.errors++;
            }
          }

          // Always create a response that includes the username (for notification)
          const replyText = createHeroInfoResponse(heroFound, username);
          console.log('Replying with:', replyText);
          
          let replySuccess = false;
          try {
            await postTweet(tokens, replyText, mention.id);
            console.log(`Replied to mention ID: ${mention.id}`);
            replySuccess = true;
            stats.repliesSent++;
            
            // Mark this tweet as replied to
            await markTweetAsReplied(mention.id, {
              heroName: heroFound.name,
              authorUsername: username || mention.author_id,
              replyText: replyText.substring(36, 69) + '...' || '' // Store preview of reply
            });
          } catch (error) {
            // Enhanced error handling for Twitter API errors
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
  // Extract candidate heroes using the heroes database
  const candidateHeroes = await extractPotentialHeroes(tweetText);
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
    const replyText = createHeroInfoResponse(heroFound, username);
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
