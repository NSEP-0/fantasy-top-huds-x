import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';

// Store loaded heroes for efficiency
let cachedHeroes = null;

/**
 * Load the heroes data from all_heroes.json
 * @returns {Promise<Array>} Array of hero objects with handle and name properties
 */
async function loadHeroes() {
  if (cachedHeroes) {
    return cachedHeroes;
  }

  try {
    const data = await fs.readFile(path.join(process.cwd(), 'all_heroes.json'), 'utf-8');
    const heroesData = JSON.parse(data);
    
    if (heroesData && Array.isArray(heroesData.data)) {
      cachedHeroes = heroesData.data.map(hero => ({
        handle: hero.handle.toLowerCase(),
        name: hero.name.toLowerCase()
      }));
      console.log(`Loaded ${cachedHeroes.length} heroes from all_heroes.json`);
      return cachedHeroes;
    }
    throw new Error('Invalid heroes data format');
  } catch (error) {
    console.error('Error loading heroes:', error.message);
    // Return empty array as fallback
    return [];
  }
}

/**
 * Normalize hero name/handle for better matching
 * @param {string} text - The text to normalize
 * @returns {string} - Normalized text
 */
function normalizeHeroText(text) {
  // Convert to lowercase
  let normalized = text.toLowerCase();
  
  // Remove dots, convert special characters
  normalized = normalized.replace(/\./g, '')
                         .replace(/\s+/g, '')
                         .replace(/[^\w]/g, '');
  
  return normalized;
}

/**
 * Check if a candidate word exactly matches any known hero handle or name
 * @param {string} candidate - Lowercase candidate word
 * @param {Array} heroes - Array of hero objects with handle and name
 * @returns {string|null} - The matching hero handle or null if not found
 */
function findMatchingHero(candidate, heroes) {
  const normalizedCandidate = normalizeHeroText(candidate);
  
  // Only do exact matches to avoid false positives
  
  // First try exact match on handle
  const exactHandleMatch = heroes.find(h => 
    normalizeHeroText(h.handle) === normalizedCandidate
  );
  if (exactHandleMatch) {
    return exactHandleMatch.handle;
  }
  
  // Then try exact match on name
  const exactNameMatch = heroes.find(h => 
    normalizeHeroText(h.name) === normalizedCandidate
  );
  if (exactNameMatch) {
    return exactNameMatch.handle;
  }
  
  return null;
}

// Define a basic list of stop words
const stopWords = ['the', 'tell', 'me', 'about', 'prices', 'market', 'and', 'a', 'an', 'of', 'for', 'give', 'details'];

/**
 * Extract potential hero handles from tweet text
 * @param {string} text - Tweet text
 * @returns {Promise<string[]>} - Array of potential hero handles
 */
async function extractPotentialHeroes(text) {
  // Load heroes data
  const heroes = await loadHeroes();
  
  // Extract words from the text
  const words = text.split(/[^\w\.@]+/)
    .map(word => word.trim())
    .filter(word => 
      word.length > 2 && 
      !stopWords.includes(word.toLowerCase())
    );
  
  console.log("Extracted words:", words);
  
  // Find matching heroes from our loaded data
  const potentialHandles = [];
  
  for (const word of words) {
    const matchedHero = findMatchingHero(word, heroes);
    if (matchedHero) {
      // Don't add duplicates
      if (!potentialHandles.includes(matchedHero)) {
        potentialHandles.push(matchedHero);
      }
    }
  }
  
  if (potentialHandles.length > 0) {
    console.log('Found potential hero matches from text:', potentialHandles);
    return potentialHandles;
  }
  
  // If no matches from known heroes, return all words as candidates
  // Instead of just using the last word
  console.log('No exact matches found. Using all words as potential heroes:', words);
  return words;
}

// CLI for testing extraction
async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('Hero extraction tester - Enter tweet text to test hero extraction');
  console.log('Type "exit" to quit');
  
  const prompt = () => {
    rl.question('\nEnter tweet text: ', async (input) => {
      if (input.toLowerCase() === 'exit') {
        rl.close();
        return;
      }
      
      try {
        const extractedHeroes = await extractPotentialHeroes(input);
        console.log('\nExtracted potential hero handles:');
        console.log(extractedHeroes);
      } catch (error) {
        console.error('Error:', error.message);
      }
      
      prompt();
    });
  };
  
  prompt();
}

main().catch(console.error);
