import dotenv from 'dotenv';
dotenv.config();
import {
  getHeroMarketInfo,
  fetchHeroByName,
  fetchHeroSupply,
  fetchCardById,
  fantasyApi
} from './fantasyService.mjs';

/**
 * Format wei value to ETH for display
 * @param {string|number} weiValue - Value in wei
 * @returns {string} - Formatted ETH value
 */
function formatWeiToEth(weiValue) {
  if (weiValue === undefined || weiValue === null) return 'N/A';
  
  try {
    const valueInEth = Number(String(weiValue)) / 1e18;
    return valueInEth.toFixed(6);
  } catch (error) {
    console.error('Error formatting wei to ETH:', error);
    return 'Error';
  }
}

/**
 * Print detailed hero market info with all price data
 * @param {Object} heroInfo - Hero market info object
 */
function printHeroMarketInfo(heroInfo) {
  console.log('\n=== HERO MARKET INFORMATION ===');
  console.log(`Name: ${heroInfo.name}`);
  console.log(`ID: ${heroInfo.id}`);
  console.log(`Followers: ${heroInfo.followers.toLocaleString()}`);
  console.log(`Stars: ${heroInfo.stars}`);
  console.log('\n--- Market Data By Rarity ---');
  
  // Sort by rarity for consistent output
  const rarities = Object.values(heroInfo.marketInfo).sort((a, b) => a.rarity - b.rarity);
  
  rarities.forEach(rarity => {
    console.log(`\n${rarity.rarityName} (Rarity Level: ${rarity.rarity}):`);
    console.log(`  Supply: ${rarity.supply || 'N/A'}`);
    
    // 1. Current Floor Price (from getLowestPriceForHeroRarity)
    console.log(`  Current Price (Lowest Asking Price):`);
    console.log(`    Raw: ${rarity.floorPrice || 'N/A'}`);
    console.log(`    ETH: ${formatWeiToEth(rarity.floorPrice)}`);
    
    // 2. Last Sell Price (from getCardMarketBasicInfo.last_trade)
    console.log(`  Last Sell Price:`);
    console.log(`    Raw: ${rarity.lastSellPrice || 'N/A'}`);
    console.log(`    ETH: ${formatWeiToEth(rarity.lastSellPrice)}`);
    
    // 3. Highest Bid (from getCardMarketBasicInfo.highest_bid)
    console.log(`  Highest Bid:`);
    console.log(`    Raw: ${rarity.highestBid || 'N/A'}`);
    console.log(`    ETH: ${formatWeiToEth(rarity.highestBid)}`);
  });
}

/**
 * Test the hero market info functionality for a specific hero
 * @param {string} heroName - Name of the hero to test
 */
async function testHeroMarketInfo(heroName) {
  console.log(`Testing getHeroMarketInfo for: ${heroName}`);
  try {
    const heroInfo = await getHeroMarketInfo(heroName);
    if (!heroInfo) {
      console.error(`No hero found with name: ${heroName}`);
      return;
    }
    
    // Print full raw object for debugging
    console.log('\n=== RAW HERO DATA ===');
    console.log(JSON.stringify(heroInfo, null, 2));
    
    // Print structured and formatted data
    printHeroMarketInfo(heroInfo);
  } catch (error) {
    console.error('Error testing hero market info:', error);
  }
}

/**
 * Test hero supply functionality for a specific hero
 * @param {string} heroName - Name of the hero to test
 */
async function testHeroSupply(heroName) {
  console.log(`Testing fetchHeroSupply for: ${heroName}`);
  try {
    const hero = await fetchHeroByName(heroName);
    if (!hero) {
      console.error(`No hero found with name: ${heroName}`);
      return;
    }
    
    console.log(`Hero ID: ${hero.id}`);
    const supplyDetails = await fetchHeroSupply(hero.id);
    
    console.log('\n=== RAW SUPPLY DATA ===');
    console.log(JSON.stringify(supplyDetails, null, 2));
    
    console.log('\n=== FORMATTED SUPPLY DATA ===');
    supplyDetails.forEach(detail => {
      const rarityName = getRarityName(detail.rarity);
      console.log(`\n${rarityName} (Rarity Level: ${detail.rarity}):`);
      console.log(`  Supply: ${detail.supply || 'N/A'}`);
      
      // Format price data if available
      if (detail.highest_bid) {
        console.log(`  Highest Bid: ${formatWeiToEth(detail.highest_bid.price || detail.highest_bid)}`);
      }
      
      if (detail.last_trade) {
        console.log(`  Last Trade: ${formatWeiToEth(detail.last_trade.price || detail.last_trade)}`);
      }
    });
  } catch (error) {
    console.error('Error testing hero supply:', error);
  }
}

/**
 * Get the rarity name based on the rarity level
 */
function getRarityName(rarityLevel) {
  switch (rarityLevel) {
    case 4: return 'Common';
    case 3: return 'Rare';
    case 2: return 'Epic';
    case 1: return 'Legendary';
    default: return 'Unknown';
  }
}

/**
 * Compare and test all three price data sources for a hero
 * @param {string} heroName - Hero name to test
 */
async function compareAllPriceData(heroName) {
  console.log(`Comparing all price data sources for: ${heroName}`);
  
  try {
    const hero = await fetchHeroByName(heroName);
    if (!hero) {
      console.error(`No hero found with name: ${heroName}`);
      return;
    }
    
    console.log(`Hero ID: ${hero.id}`);
    
    // Test each rarity level
    for (const rarityLevel of [1, 2, 3, 4]) {
      const rarityName = getRarityName(rarityLevel);
      console.log(`\n--- Testing ${rarityName} (${rarityLevel}) ---`);
      
      const heroRarityIndex = `${hero.id}_${rarityLevel}`;
      
      // 1. Get lowest price (current floor)
      try {
        const lowestPrice = await fantasyApi.marketplace.getLowestPriceForHeroRarity({
          heroRarityIndex: heroRarityIndex
        });
        
        console.log(`1. Current Price (Lowest Asking): ${formatWeiToEth(lowestPrice?.data)} ETH (raw: ${lowestPrice?.data})`);
      } catch (error) {
        console.log(`Error getting lowest price: ${error.message}`);
      }
      
      // 2. Get market basic info (last_trade and highest_bid)
      try {
        const marketBasicInfo = await fantasyApi.marketplace.getCardMarketBasicInfo({
          heroRarityIndex: heroRarityIndex
        });
        
        if (marketBasicInfo && marketBasicInfo.data) {
          const data = marketBasicInfo.data;
          
          if (data.last_trade && data.last_trade.price) {
            console.log(`2. Last Trade: ${formatWeiToEth(data.last_trade.price)} ETH (raw: ${data.last_trade.price})`);
          } else {
            console.log('2. Last Trade: N/A');
          }
          
          if (data.highest_bid && data.highest_bid.price) {
            console.log(`3. Highest Bid: ${formatWeiToEth(data.highest_bid.price)} ETH (raw: ${data.highest_bid.price})`);
          } else {
            console.log('3. Highest Bid: N/A');
          }
        } else {
          console.log('No market basic info returned');
        }
      } catch (error) {
        console.log(`Error getting market basic info: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('Error comparing price data:', error);
  }
}

/**
 * Display help information for using the script
 */
function displayHelp() {
  console.log('\nUsage: node test.mjs [hero_name] [options]');
  console.log('\nOptions:');
  console.log('  --supply    Test supply data for the specified hero');
  console.log('  --prices    Test detailed price data for the specified hero');
  console.log('  --help      Display this help message');
  console.log('\nExamples:');
  console.log('  node test.mjs rasmr              # Test market info for rasmr');
  console.log('  node test.mjs orangie --supply   # Test supply data for orangie');
  console.log('  node test.mjs TylerDurden --prices  # Test price data for TylerDurden');
  console.log('  node test.mjs vydamo_            # Test market info for vydamo_\n');
}

/**
 * Main function - parse command line arguments and run appropriate tests
 */
async function main() {
  // Process command line arguments
  const args = process.argv.slice(2);
  
  // Check if help is requested
  if (args.includes('--help') || args.includes('-h')) {
    displayHelp();
    return;
  }
  
  // Default values
  let heroName = '';
  let testType = 'market'; // Default test type
  
  // Extract hero name (first non-flag argument)
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      heroName = arg;
      break;
    }
  }
  
  // If no hero name provided, prompt for one
  if (!heroName) {
    console.log('No hero name provided. Please specify a hero name.');
    console.log('Example: node test.mjs rasmr');
    console.log('For more information, use: node test.mjs --help');
    return;
  }
  
  // Determine test type
  if (args.includes('--supply')) {
    testType = 'supply';
  } else if (args.includes('--prices')) {
    testType = 'prices';
  }
  
  console.log(`Running ${testType} test for hero: ${heroName}`);
  
  // Run the appropriate test
  if (testType === 'supply') {
    await testHeroSupply(heroName);
  } else if (testType === 'prices') {
    await compareAllPriceData(heroName);
  } else {
    await testHeroMarketInfo(heroName);
  }
}

// Run the main function
main().catch(error => {
  console.error('Error in main function:', error);
  console.log('For help, use: node test.mjs --help');
});