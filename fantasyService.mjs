import dotenv from 'dotenv';
import { Client, Configuration } from '@fantasy-top/sdk-pro';
import { getRarityName } from './utils/formatters.mjs';

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

// Rate limiting configuration
const API_RATE_LIMIT = {
  maxRequestsPerMinute: 60, // Adjust based on actual API limits
  requestHistory: [],
  resetTimeoutId: null
};

/**
 * Rate limiter utility for API calls
 * @returns {Promise<void>} Resolves when it's safe to make a request
 */
async function rateLimiter() {
  // Clean old requests (older than 1 minute)
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  API_RATE_LIMIT.requestHistory = API_RATE_LIMIT.requestHistory.filter(
    timestamp => timestamp > oneMinuteAgo
  );
  
  // Check if we've hit the rate limit
  if (API_RATE_LIMIT.requestHistory.length >= API_RATE_LIMIT.maxRequestsPerMinute) {
    // Calculate how long to wait before next request
    const oldestRequest = API_RATE_LIMIT.requestHistory[0];
    const timeToWait = oldestRequest + 60000 - now;
    
    console.warn(`Rate limit reached. Waiting ${Math.ceil(timeToWait/1000)} seconds...`);
    
    return new Promise(resolve => {
      setTimeout(() => {
        // Try again after waiting
        resolve(rateLimiter());
      }, timeToWait + 100); // Add 100ms buffer
    });
  }
  
  // Record this request
  API_RATE_LIMIT.requestHistory.push(now);
  return Promise.resolve();
}

/**
 * Wrapper function to apply rate limiting and retries to API calls
 * @param {Function} apiCall - Function that makes the API call
 * @param {Array} args - Arguments to pass to the API call
 * @param {Object} options - Options for retries
 * @returns {Promise} - Result of the API call
 */
async function withRateLimitAndRetry(apiCall, args = [], options = {}) {
  const { maxRetries = 3, baseDelay = 1000 } = options;
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Wait for rate limiter before proceeding
      await rateLimiter();
      
      // Make the API call
      return await apiCall(...args);
    } catch (error) {
      lastError = error;
      
      // Check if it's a rate limit error or other retriable error
      const isRateLimit = 
        error.message.includes('rate limit') || 
        error.message.includes('too many requests') ||
        (error.response && (error.response.status === 429 || error.response.status === 403));
      
      if (attempt < maxRetries) {
        // Calculate exponential backoff delay
        const delay = isRateLimit ? 
          baseDelay * Math.pow(2, attempt) : // Rate limit: exponential backoff
          baseDelay * (attempt + 1); // Other errors: linear backoff
        
        console.warn(`API call failed with ${error.response?.status || 'unknown'} status. Retrying in ${delay/1000} seconds... (Attempt ${attempt+1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`API call failed after ${maxRetries} retries.`, error);
        throw error;
      }
    }
  }
  
  throw lastError;
}

/**
 * Fetch a hero by handle or name, with enhanced search capabilities.
 * @param {string} heroName - Hero's handle or name.
 * @returns {Promise<Object>} - The hero object or null if not found.
 */
export async function fetchHeroByName(heroName) {
  return withRateLimitAndRetry(
    async (name) => {
      // Clean the input - trim spaces for consistency
      const cleanName = name.trim();
      
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
      
      console.log(`No hero found with name: "${name}"`);
      return null;
    },
    [heroName],
    { maxRetries: 3, baseDelay: 2000 }
  );
}

/**
 * Fetch heroes by a list of IDs.
 * @param {Array<string>} heroIds - List of hero IDs.
 * @returns {Promise<Array>} - The heroes data.
 */
export async function fetchHeroesByIds(heroIds) {
  return withRateLimitAndRetry(
    async (ids) => {
      console.log('Requesting hero data for IDs:', ids);
      const response = await fantasyApi.hero.getHeroesByIds({
        ids: ids
      });
      
      // Handle both response formats (direct data or nested in data property)
      const heroes = response.data || response;
      console.log(`Found ${heroes.length} heroes by IDs`);
      
      return heroes;
    },
    [heroIds],
    { maxRetries: 3, baseDelay: 2000 }
  );
}

/**
 * Fetch heroes by a list of names.
 * @param {Array<string>} heroNames - List of hero names.
 * @returns {Promise<Array>} - The heroes data.
 */
export async function fetchHeroesByNames(heroNames) {
  return withRateLimitAndRetry(
    async (names) => {
      console.log('Requesting hero data for names:', names);
      const heroIds = await Promise.all(names.map(async (name) => {
        const hero = await fetchHeroByName(name);
        return hero ? hero.id : null;
      }));
      
      const validHeroIds = heroIds.filter(id => id !== null);
      if (validHeroIds.length === 0) {
        console.log('No valid hero IDs found.');
        return [];
      }
      
      return fetchHeroesByIds(validHeroIds);
    },
    [heroNames],
    { maxRetries: 3, baseDelay: 2000 }
  );
}

/**
 * Fetch card details by card ID.
 * @param {string} cardId - Card ID.
 * @returns {Promise<Object>} - Card details.
 */
export async function fetchCardById(cardId) {
  return withRateLimitAndRetry(
    async (id) => {
      const response = await fantasyApi.card.getCardById({
        id: id
      });
      
      return response.data || response;
    },
    [cardId],
    { maxRetries: 3, baseDelay: 2000 }
  );
}

/**
 * Fetch hero supply details by hero ID.
 * @param {string} heroId - Hero ID.
 * @returns {Promise<Array>} - Hero supply details.
 */
export async function fetchHeroSupply(heroId) {
  return withRateLimitAndRetry(
    async (id) => {
      console.log(`Fetching supply details for hero ID: ${id}`);
      const response = await fantasyApi.card.getHeroSupply({
        heroId: id
      });
      
      // Handle response format - may be nested in data property
      const supplyData = response.data || response;
      
      if (!supplyData || !Array.isArray(supplyData)) {
        console.warn(`Unexpected response format for hero supply: ${JSON.stringify(response)}`);
        return [];
      }
      
      console.log(`Got supply details: ${supplyData.length} entries`);
      return supplyData;
    },
    [heroId],
    { maxRetries: 3, baseDelay: 2000 }
  );
}

/**
 * Get the lowest price (floor) for a hero's rarity.
 * @param {string} heroRarityIndex - Hero rarity index in format "heroId_rarityLevel"
 * @returns {Promise<string|null>} - Raw wei value or null if not available
 */
async function getLowestPriceForHeroRarity(heroRarityIndex) {
  return withRateLimitAndRetry(
    async (index) => {
      const response = await fantasyApi.marketplace.getLowestPriceForHeroRarity({
        heroRarityIndex: index
      });
      
      // Better logging of the response
      console.log(`Floor price response for ${index}:`, response?.data);
      
      // Return raw wei value - will be formatted in the bot
      if (response && response.data !== undefined && response.data !== null) {
        return response.data;
      }
      
      console.log(`No valid floor price found for ${index}`);
      return null;
    },
    [heroRarityIndex],
    { maxRetries: 2, baseDelay: 1000 }
  );
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