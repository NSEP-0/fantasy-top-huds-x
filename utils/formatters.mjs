/**
 * Utility functions for formatting data in consistent ways
 */

/**
 * Format a date for Twitter API's datetime parameters
 * Ensures the exact format required by Twitter API: YYYY-MM-DDTHH:mm:ssZ
 * 
 * @param {Date} date - The date to format
 * @returns {string} - Formatted date string in YYYY-MM-DDTHH:mm:ssZ format
 */
export function formatTwitterDate(date) {
  // Format as YYYY-MM-DDTHH:mm:ssZ (without milliseconds)
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Formats wei value to ETH with proper decimal places
 * @param {string|number} weiValue - Value in wei
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted ETH value
 */
export function formatWeiToEth(weiValue, decimals = 3) {
  if (!weiValue && weiValue !== 0) {
    return 'N/A';
  }
  
  const valueAsString = String(weiValue);
  
  if (isNaN(Number(valueAsString))) {
    return 'N/A';
  }
  
  if (Number(valueAsString) === 0) {
    return '0.000';
  }
  
  const valueInEth = Number(valueAsString) / 1e18;
  return valueInEth.toFixed(decimals);
}

/**
 * Gets the rarity name based on the rarity level (1-4).
 * @param {number} rarityLevel - Rarity level (1-4).
 * @returns {string} - Rarity name.
 */
export function getRarityName(rarityLevel) {
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
