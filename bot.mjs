// bot.mjs
import dotenv from 'dotenv';
dotenv.config();
import readline from 'readline';
import { requestToken, accessToken, loadTokens, saveTokens } from './auth.mjs';
import { postTweet } from './twitterClient.mjs';
import { getHeroMarketInfo } from './fantasyService.mjs';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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
 * Main entry point: ensures tokens exist, then attempts to post hero info.
 */
(async () => {
  console.log('Attempting to load existing Twitter tokens.');
  let tokens = await loadTokens();
  if (!tokens) {
    console.log('No tokens found. Starting OAuth flow.');
    const oAuthRequestToken = await requestToken();
    console.log('Please go to the following URL to authorize your app:');
    console.log(`https://api.twitter.com/oauth/authorize?oauth_token=${oAuthRequestToken.oauth_token}`);
    const pin = await input('Enter the PIN provided by Twitter: ');
    rl.close();
    try {
      tokens = await accessToken(oAuthRequestToken, pin.trim());
      await saveTokens(tokens);
    } catch (error) {
      console.error('Error during token exchange:', error);
      return;
    }
  }

  // Example usage: post hero info for "rasmr"
  const testHeroName = 'rasmr';
  console.log(`Fetching and posting hero info for: ${testHeroName}`);
  await postHeroInfoTweet(testHeroName);
})();
