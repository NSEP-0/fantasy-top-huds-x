// fantasyService.mjs
import dotenv from 'dotenv';
import { Client, Configuration } from '@fantasy-top/sdk-pro';
import got from 'got';

dotenv.config();

if (!process.env.FTOP_API_KEY) {
  console.error('FTOP_API_KEY is not defined in your .env file');
  process.exit(1);
}

// Configure the Fantasy Top SDK
const config = new Configuration({
  basePath: process.env.API_URL || 'https://api-v2.fantasy.top',
  apiKey: process.env.FTOP_API_KEY,
});
const fantasyApi = Client.getInstance(config);

/**
 * Calls the marketplace sell-orders endpoint to find the floor price for
 * a specific hero *and* rarity, using heroHandle in the query but filtering
 * by heroId in-memory to avoid collisions.
 *
 * @param {string} heroHandle - The hero's handle or name (e.g., "rasmr").
 * @param {string} heroId - The hero's unique ID from the API (e.g., "423164349").
 * @param {number} rarity - The rarity level (1, 2, 3, or 4).
 * @returns {Promise<string>} The floor price as a string, or "N/A" if none found.
 */
async function getFloorPrice(heroHandle, heroId, rarity) {
  const url = `${config.basePath}/marketplace/sell-orders?search=${encodeURIComponent(heroHandle)}&rankCriteria=0&pagination[page]=1&pagination[limit]=50`;
  
  try {
    const response = await got(url, {
      headers: {
        accept: 'application/json',
        'x-api-key': process.env.FTOP_API_KEY,
      },
      responseType: 'json',
    });

    const orders = response.body?.data || [];
    if (orders.length === 0) {
      return 'N/A';
    }
    // Filter to ensure the correct hero_id AND correct rarity.
    const matchingOrders = orders.filter((order) =>
      order.hero_id === heroId && Number(order.rarity) === Number(rarity)
    );
    if (matchingOrders.length === 0) {
      return 'N/A';
    }
    // Among matching orders, pick the lowest price_numeric.
    const prices = matchingOrders.map((order) => parseFloat(order.price_numeric));
    const floor = Math.min(...prices);
    return floor.toString();
  } catch (error) {
    console.error(`Error fetching floor price for handle="${heroHandle}", heroId="${heroId}", rarity=${rarity}:`,
      error.response ? error.response.body : error.message
    );
    return 'N/A';
  }
}

/**
 * Retrieves hero information and supply details from Fantasy Top,
 * then adds a floor price for each rarity by calling getFloorPrice().
 *
 * Steps:
 * 1. Searches for heroes by name/handle using the Hero API (hero.getHeroesByHandleOrName).
 * 2. Uses the first matching hero. 
 * 3. Fetches the hero's supply details via the Card API (card.getHeroSupply). ## |TODO: THIS ISN'T CORRECT/MATCHING TO UI DATA
 * 4. Groups supply by rarity.
 * 5. For each rarity, calls getFloorPrice() to obtain a floor price from the marketplace.
 *
 * Returns an object:
 * {
 *   name: string,
 *   supplyDetails: [
 *     {
 *       rarity: number,
 *       supply: number,
 *       lastSellPrice: string|number,
 *       floorPrice: string
 *     },
 *     ...
 *   ]
 * }
 *
 * @param {string} heroName - The hero name (or handle) to search for.
 * @returns {Promise<Object|null>}
 */
export async function getHeroInfo(heroName) {
  try {
    // 1. Search for the hero by name/handle
    const heroResponse = await fantasyApi.hero.getHeroesByHandleOrName({ search: heroName });
    if (!heroResponse.data || heroResponse.data.length === 0) {
      console.error(`No hero found with the name: ${heroName}`);
      return null;
    }
    const hero = heroResponse.data[0];
    
    // We'll use hero.handle if available, else hero.name, to query the marketplace
    const heroHandle = hero.handle || hero.name;
    const heroId = hero.id; // e.g. "423164349"
    console.log(heroHandle, heroId);

    // 2. Fetch hero supply
    const supplyResponse = await fantasyApi.card.getHeroSupply({ heroId: heroId });
    const rawSupplyData = supplyResponse.data || [];
    console.log(rawSupplyData);
    if (rawSupplyData.length === 0) {
      console.warn(`No supply data found for hero: ${hero.name}`);
      return { name: hero.name, supplyDetails: [] };
    }

    // 3. Group supply by rarity to avoid duplicates
    const grouped = {};
    for (const detail of rawSupplyData) {
      const rarityKey = detail.rarity;
      if (!grouped[rarityKey]) {
        grouped[rarityKey] = { ...detail };
      } else {
        grouped[rarityKey].supply = detail.supply;
        // Optionally handle or merge lastSellPrice if needed.
      }
    }
    const uniqueDetails = Object.values(grouped);

    // 4. For each rarity, fetch the floor price from the marketplace
    const supplyDetails = await Promise.all(
      uniqueDetails.map(async (detail) => {
        const floor = await getFloorPrice(heroHandle, heroId, detail.rarity);
        return {
          rarity: detail.rarity,
          supply: detail.supply,
          lastSellPrice: detail.lastSellPrice !== undefined ? detail.lastSellPrice : 'N/A',
          floorPrice: floor,
        };
      })
    );

    // 5. Return final result
    return {
      name: hero.name,
      supplyDetails
    };

  } catch (error) {
    console.error(
      'Error fetching hero info:',
      error.response ? error.response.data : error.message
    );
    throw error;
  }
}

// If this module is run directly, run a quick test
if (process.argv[1].includes('fantasyService.mjs')) {
  (async () => {
    // If you run "node fantasyService.mjs rasmr" => heroName="rasmr"
    const heroName = process.argv[2] || 'Evan Van Ness 🧉';
    console.log(`Fetching hero info for: ${heroName}`);
    try {
      const heroInfo = await getHeroInfo(heroName);
      if (heroInfo) {
        console.log('Hero Info:');
        console.log(JSON.stringify(heroInfo, null, 2));
      } else {
        console.log('No hero info returned.');
      }
    } catch (error) {
      console.error('Test run failed:', error);
    }
  })();
}
