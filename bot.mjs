// bot.mjs
import dotenv from 'dotenv';
dotenv.config();
import readline from 'readline';
import { requestToken, accessToken, loadTokens, saveTokens } from './auth.mjs';
import { postTweet } from './twitterClient.mjs';
import { getHeroInfo } from './fantasyService.mjs';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function input(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/**
 * Maps the numeric rarity (1, 2, 3, 4) to a label.
 * Adjust as needed if you want different names for these rarities.
 */
function mapRarityToLabel(rarity) {
  switch (rarity) {
    case 1:
      return 'Legendary';
    case 2:
      return 'Epic';
    case 3:
      return 'Rare';
    case 4:
      return 'Common';
    default:
      return `Rarity ${rarity}`;
  }
}

/**
 * Composes and posts a tweet with hero info from Fantasy Top,
 * converting numeric rarity to a label like Legendary/Epic/Rare/Common.
 *
 * @param {string} heroName - The hero name (or handle) to search for.
 * @param {string|null} replyToTweetId - (Optional) A tweet ID to reply to.
 */
async function postHeroInfoTweet(heroName, replyToTweetId = null) {
  let heroInfo;
  try {
    // Fetch hero details (including supply, lastSellPrice, and floorPrice).
    heroInfo = await getHeroInfo(heroName);
    if (!heroInfo) {
      console.error(`No hero found with the name: "${heroName}"`);
      return;
    }
  } catch (error) {
    console.error(`Error fetching hero info for "${heroName}":`, error);
    return;
  }

  // Construct the tweet text:
  // e.g. "rasmr\n\nSupply Details:\nLegendary: 1 cards ...\n..."
  let message = `${heroInfo.name}\n\nSupply Details:\n`;

  for (const detail of heroInfo.supplyDetails) {
    // Convert numeric rarity to label, e.g. 1 => "Legendary"
    const rarityLabel = mapRarityToLabel(detail.rarity);

    // Start line with the label + supply
    let line = `${rarityLabel}: ${detail.supply} cards`;

    // Append lastSellPrice if not "N/A"
    if (detail.lastSellPrice && detail.lastSellPrice !== 'N/A') {
      line += `, Last Sell Price: ${detail.lastSellPrice}`;
    }

    // Append floorPrice if not "N/A"
    if (detail.floorPrice && detail.floorPrice !== 'N/A') {
      line += `, Floor Price: ${detail.floorPrice}`;
    }

    message += line + '\n';
  }

  // Optionally add a link if your account can post it without triggering issues
  message += `\nCheck out more on Fantasy Top!`;
  // message += '\nhttps://fantasy.top'; // If including this link triggers a 403, consider removing or using a URL shortener

  try {
    const tokens = await loadTokens();
    if (!tokens) {
      console.error('No valid tokens found. Please authenticate first.');
      return;
    }
    console.log('Posting tweet with hero info...');
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

  // Example usage: post hero info for "rasmr" "Orangie"
  const testHeroName = 'rasmr';
  console.log(`Fetching and posting hero info for: ${testHeroName}`);
  await postHeroInfoTweet(testHeroName);
})();
