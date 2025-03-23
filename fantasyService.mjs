import dotenv from 'dotenv';
import { Client, Configuration } from '@fantasy-top/sdk-pro';

// Load environment variables
dotenv.config();

if (!process.env.FTOP_API_KEY) {
  throw new Error('FTOP_API_KEY is not defined. Please check your .env file.');
}

// Configure the Fantasy Top API client
const config = new Configuration({
  basePath: process.env.API_URL || 'https://api-v2.fantasy.top',
  apiKey: process.env.FTOP_API_KEY,
});

export const fantasyApi = Client.getInstance(config);

/**
 * Fetch a hero by handle or name, with enhanced search capabilities.
 * @param {string} heroName - Hero's handle or name.
 * @returns {Promise<Object>} - The hero object or null if not found.
 */
export async function fetchHeroByName(heroName) {
  try {
    // Clean the input - trim spaces for consistency
    const cleanName = heroName.trim();
    
    console.log(`Searching for hero with name: "${cleanName}"`);
    
    // Try the original search first
    const response = await fantasyApi.hero.getHeroesByHandleOrName({
      search: cleanName
    });
    
    // Access the data array from the response
    const heroes = response.data || [];
    
    // Check if we have results
    if (heroes && heroes.length > 0) {
      console.log(`Found hero: ${heroes[0].handle || heroes[0].name}`);
      return heroes[0];
    }
    
    console.log(`No hero found with name: "${heroName}"`);
    return null;
  } catch (error) {
    console.error('Error fetching hero by name:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch heroes by a list of IDs.
 * @param {Array<string>} heroIds - List of hero IDs.
 * @returns {Promise<Array>} - The heroes data.
 */
export async function fetchHeroesByIds(heroIds) {
  try {
    console.log('Requesting hero data for IDs:', heroIds);
    const response = await fantasyApi.hero.getHeroesByIds({
      ids: heroIds
    });
    
    // Handle both response formats (direct data or nested in data property)
    const heroes = response.data || response;
    console.log(`Found ${heroes.length} heroes by IDs`);
    
    return heroes;
  } catch (error) {
    console.error('Error fetching heroes by IDs:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch heroes by a list of names.
 * @param {Array<string>} heroNames - List of hero names.
 * @returns {Promise<Array>} - The heroes data.
 */
export async function fetchHeroesByNames(heroNames) {
  try {
    console.log('Requesting hero data for names:', heroNames);
    const heroIds = await Promise.all(heroNames.map(async (name) => {
      const hero = await fetchHeroByName(name);
      return hero ? hero.id : null;
    }));
    
    const validHeroIds = heroIds.filter(id => id !== null);
    if (validHeroIds.length === 0) {
      console.log('No valid hero IDs found.');
      return [];
    }
    
    return fetchHeroesByIds(validHeroIds);
  } catch (error) {
    console.error('Error fetching heroes by names:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch card details by card ID.
 * @param {string} cardId - Card ID.
 * @returns {Promise<Object>} - Card details.
 */
export async function fetchCardById(cardId) {
  try {
    const response = await fantasyApi.card.getCardById({
      id: cardId
    });
    
    return response.data || response;
  } catch (error) {
    console.error('Error fetching card by ID:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch hero supply details by hero ID.
 * @param {string} heroId - Hero ID.
 * @returns {Promise<Array>} - Hero supply details.
 */
export async function fetchHeroSupply(heroId) {
  try {
    console.log(`Fetching supply details for hero ID: ${heroId}`);
    const response = await fantasyApi.card.getHeroSupply({
      heroId: heroId
    });
    
    // Handle response format - may be nested in data property
    const supplyData = response.data || response;
    
    if (!supplyData || !Array.isArray(supplyData)) {
      console.warn(`Unexpected response format for hero supply: ${JSON.stringify(response)}`);
      return [];
    }
    
    console.log(`Got supply details: ${supplyData.length} entries`);
    return supplyData;
  } catch (error) {
    console.error('Error fetching hero supply:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get the rarity name based on the rarity level (1-4).
 * @param {number} rarityLevel - Rarity level (1-4).
 * @returns {string} - Rarity name.
 */
function getRarityName(rarityLevel) {
  switch (rarityLevel) {
    case 4:
      return 'Common';
    case 3:
      return 'Rare';
    case 2:
      return 'Epic';
    case 1:
      return 'Legendary';
    default:
      return 'Unknown';
  }
}

/**
 * Get the lowest price (floor) for a hero's rarity.
 * @param {string} heroRarityIndex - Hero rarity index in format "heroId_rarityLevel"
 * @returns {Promise<string|null>} - Raw wei value or null if not available
 */
async function getLowestPriceForHeroRarity(heroRarityIndex) {
  try {
    const response = await fantasyApi.marketplace.getLowestPriceForHeroRarity({
      heroRarityIndex: heroRarityIndex
    });
    
    // Better logging of the response
    console.log(`Floor price response for ${heroRarityIndex}:`, response?.data);
    
    // Return raw wei value - will be formatted in the bot
    if (response && response.data !== undefined && response.data !== null) {
      return response.data;
    }
    
    console.log(`No valid floor price found for ${heroRarityIndex}`);
    return null;
  } catch (error) {
    console.warn(`Failed to get lowest price for ${heroRarityIndex}: ${error.message}`);
    return null;
  }
}

/**
 * Comprehensive function to get all hero market information from multiple API sources.
 * Combines data from both supply API and marketplace API for complete market information.
 * Returns raw wei values for prices.
 * 
 * @param {string} heroName - Hero's handle or name.
 * @returns {Promise<Object|null>} - Complete hero information with detailed market data.
 */
export async function getHeroMarketInfo(heroName) {
  try {
    console.log(`Getting detailed market info for hero: ${heroName}`);
    
    // First get the basic hero info
    let hero = await fetchHeroByName(heroName);
    
    // If not found, try with _eth suffix if not already present
    if (!hero && !heroName.toLowerCase().endsWith('_eth')) {
      console.log(`Trying with _eth suffix: ${heroName}_eth`);
      hero = await fetchHeroByName(`${heroName}_eth`);
    }
    
    if (!hero) {
      console.error(`Could not find hero with name/handle: ${heroName}`);
      return null;
    }

    console.log(`Successfully found hero: ${hero.handle || hero.name} (ID: ${hero.id})`);
    
    // Step 1: Fetch hero supply details
    const supplyDetails = await fetchHeroSupply(hero.id);
    console.log(`Got supply details: ${supplyDetails.length} entries`);
    
    // Step 2: Process the supply data into a market info structure
    const marketInfo = {};
    supplyDetails.forEach(detail => {
      const rarityLevel = detail.rarity;
      // Log the raw data for each rarity
      console.log(`Raw supply detail for rarity ${rarityLevel}:`, JSON.stringify(detail, null, 2));
      
      marketInfo[rarityLevel] = {
        rarity: rarityLevel,
        rarityName: getRarityName(rarityLevel),
        supply: detail.supply || null,
        highestBid: detail.highest_bid?.price || null,
        lastSellPrice: detail.last_trade?.price || null,
        floorPrice: null // Will be populated with getLowestPriceForHeroRarity
      };
    });
    
    // Step 3: For each rarity level, enhance data with marketplace API
    const rarityLevels = [4, 3, 2, 1]; // Common, Rare, Epic, Legendary
    
    await Promise.all(rarityLevels.map(async (level) => {
      // Only create an entry if we don't have it from supply data
      if (!marketInfo[level]) {
        marketInfo[level] = {
          rarity: level,
          rarityName: getRarityName(level),
          supply: null,
          highestBid: null,
          lastSellPrice: null,
          floorPrice: null
        };
      }
      
      // Get lowest price (current floor) for each rarity level
      const rarityIndex = `${hero.id}_${level}`;
      marketInfo[level].floorPrice = await getLowestPriceForHeroRarity(rarityIndex);
      
      // Enhance with more market data from getCardMarketBasicInfo
      try {
        const response = await fantasyApi.marketplace.getCardMarketBasicInfo({
          heroRarityIndex: rarityIndex
        });
        
        const data = response.data || response;
        
        // Update highest bid if available and not already set
        if (data && data.highest_bid && data.highest_bid.price !== undefined && !marketInfo[level].highestBid) {
          marketInfo[level].highestBid = data.highest_bid.price;
          console.log(`Updated highest bid for ${rarityIndex}: ${data.highest_bid.price}`);
        }
        
        // Update last sell price if available and not already set
        if (data && data.last_trade && data.last_trade.price !== undefined && !marketInfo[level].lastSellPrice) {
          marketInfo[level].lastSellPrice = data.last_trade.price;
          console.log(`Updated last trade price for ${rarityIndex}: ${data.last_trade.price}`);
        }
      } catch (error) {
        console.warn(`Failed to get market data for ${rarityIndex}: ${error.message}`);
      }
    }));
    
    console.log('Final market info:');
    console.log(JSON.stringify(marketInfo, null, 2));
    
    // Return complete hero info with raw wei values
    return {
      id: hero.id,
      name: hero.handle || hero.name,
      profileImage: hero.profile_image_url_https,
      followers: hero.followers_count || 0,
      stars: hero.stars || 0,
      marketInfo: marketInfo
    };
  } catch (error) {
    console.error('Error getting hero market info:', error.message);
    throw error;
  }
}