/**
 * Utilities for extracting hero information from text
 */
import fs from 'fs/promises';
import path from 'path';

// Define a basic list of stop words
const STOP_WORDS = ['hey', 'hello', 'what', 'you', 'know', 'the', 'tell', 'me', 'about', 'prices', 'market', 'and', 'a', 'an', 'of', 'for', 'give', 'details'];

// Store loaded heroes for efficiency
let cachedHeroes = null;

/**
 * Load the heroes data from all_heroes.json
 * @returns {Promise<Array>} Array of hero objects with handle and name properties
 */
export async function loadHeroes() {
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
export function normalizeHeroText(text) {
  // Convert to lowercase
  let normalized = text.toLowerCase();
  
  // Remove dots, convert special characters
  normalized = normalized.replace(/\./g, '')
                         .replace(/\s+/g, '')
                         .replace(/[^\w]/g, '');
  
  return normalized;
}

/**
 * Check if a candidate word matches any known hero handle or name
 * @param {string} candidate - Lowercase candidate word
 * @param {Array} heroes - Array of hero objects with handle and name
 * @returns {Object|null} - The matching hero object or null if not found
 */
export function findMatchingHero(candidate, heroes) {
  const normalizedCandidate = normalizeHeroText(candidate);
  
  // Prepare all heroes with normalized values for better matching
  const normalizedHeroes = heroes.map(hero => ({
    ...hero,
    normalizedHandle: normalizeHeroText(hero.handle),
    normalizedName: normalizeHeroText(hero.name)
  }));
  
  // 1. First priority: Exact match on handle (normalized)
  const exactHandleMatch = normalizedHeroes.find(h => 
    h.normalizedHandle === normalizedCandidate
  );
  if (exactHandleMatch) {
    console.log(`Found exact handle match: ${exactHandleMatch.handle} for ${candidate}`);
    return exactHandleMatch;
  }
  
  // 2. Second priority: Exact match on name (normalized)
  const exactNameMatch = normalizedHeroes.find(h => 
    h.normalizedName === normalizedCandidate
  );
  if (exactNameMatch) {
    console.log(`Found exact name match: ${exactNameMatch.handle} (${exactNameMatch.name}) for ${candidate}`);
    return exactNameMatch;
  }
  
  // No match found
  return null;
}

/**
 * Extract potential hero handles from tweet text
 * @param {string} text - Tweet text
 * @param {Object} tweetEntities - The entities object from Twitter (optional)
 * @returns {Promise<string[]>} - Array of potential hero handles
 */
export async function extractPotentialHeroes(text, tweetEntities = null) {
  // First try to get potential heroes from Twitter's annotations if available
  const annotationCandidates = tweetEntities ? extractFromAnnotations(tweetEntities) : [];
  
  // Load heroes data for matching
  const heroes = await loadHeroes();
  
  // Process annotation candidates first
  const potentialMatches = [];
  
  // Check annotation candidates against hero database
  for (const candidate of annotationCandidates) {
    const matchedHero = findMatchingHero(candidate, heroes);
    if (matchedHero) {
      if (!potentialMatches.some(m => m.handle === matchedHero.handle)) {
        potentialMatches.push(matchedHero);
      }
    }
  }
  
  // If we found matches from annotations, use those
  if (potentialMatches.length > 0) {
    const handles = potentialMatches.map(hero => hero.handle);
    console.log('Found hero matches from Twitter annotations:', 
      potentialMatches.map(h => `${h.handle} (${h.name})`).join(', ')
    );
    return handles;
  }
  
  // Otherwise, fall back to our text parsing approach
  // Extract words from the text - improved tokenization
  const words = text.split(/[^\w\.@]+/)  // Split on non-word, non-dot, non-@ characters
    .map(word => word.trim())
    .filter(word => 
      word.length > 2 && 
      !STOP_WORDS.includes(word.toLowerCase())
    );
  
  console.log("Extracted words:", words);
  
  // Find matching heroes from our loaded data using exact matches
  const potentialMatchesFromText = [];
  
  for (const word of words) {
    const matchedHero = findMatchingHero(word, heroes);
    if (matchedHero) {
      // Store the full hero object for better logging
      if (!potentialMatchesFromText.some(m => m.handle === matchedHero.handle)) {
        potentialMatchesFromText.push(matchedHero);
      }
    }
  }
  
  if (potentialMatchesFromText.length > 0) {
    // Extract just the handles for API calls
    const handles = potentialMatchesFromText.map(hero => hero.handle);
    console.log('Found potential hero matches:', 
      potentialMatchesFromText.map(h => `${h.handle} (${h.name})`).join(', ')
    );
    return handles;
  }
  
  // If no matches from known heroes, return all words as candidates
  console.log('No exact matches found. Using all words as potential heroes:', words);
  return words;
}

/**
 * Extract hero names from Twitter's entity annotations
 * @param {Object} tweetEntities - The entities object from Twitter
 * @returns {string[]} - Array of potential hero names from annotations
 */
export function extractFromAnnotations(tweetEntities) {
  if (!tweetEntities || !tweetEntities.annotations) {
    return [];
  }
  
  // Extract entity annotations (focusing on Person and Other types which might be hero names)
  const potentialNames = tweetEntities.annotations
    .filter(anno => anno.probability > 0.5) // Only consider annotations with decent confidence
    .map(anno => anno.normalized_text);
  
  if (potentialNames.length > 0) {
    console.log('Found potential names from Twitter annotations:', potentialNames);
  }
  
  return potentialNames;
}
