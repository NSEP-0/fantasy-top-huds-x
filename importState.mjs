/**
 * State Import/Export Utility
 * 
 * This utility helps migrate state between different environments (local/cloud)
 * and initialize state with proper values.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { importFullState, exportFullState } from './dynamoStateManager.mjs';
import { synchronizeState, resetState } from './stateManager.mjs';

// Load environment variables
dotenv.config();

// Directory setup
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'state.json');

/**
 * Import state from a file to DynamoDB
 */
async function importStateToDynamo() {
  try {
    console.log('📤 Importing state from local file to DynamoDB...');
    
    // Read the state file
    const stateData = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    
    // Import to DynamoDB with the right format
    const result = await importFullState(stateData);
    
    if (result) {
      console.log('✅ State successfully imported to DynamoDB');
    } else {
      console.error('❌ Failed to import state to DynamoDB');
    }
  } catch (error) {
    console.error('❌ Error importing state:', error);
  }
}

/**
 * Export state from DynamoDB to a local file
 */
async function exportStateFromDynamo() {
  try {
    console.log('📥 Exporting state from DynamoDB to local file...');
    
    // Load state from DynamoDB
    const stateData = await exportFullState();
    
    if (!stateData) {
      console.error('❌ No state found in DynamoDB');
      return;
    }
    
    // Write to the state file with pretty formatting
    await fs.writeFile(
      STATE_FILE, 
      JSON.stringify(stateData, null, 2),
      'utf8'
    );
    
    console.log(`✅ State successfully exported to ${STATE_FILE}`);
  } catch (error) {
    console.error('❌ Error exporting state:', error);
  }
}

/**
 * Reset/Initialize state with default values
 * @param {string} target - 'file', 'dynamo', or 'all'
 */
async function initializeState(target = 'all') {
  try {
    console.log(`🔄 Initializing ${target} state...`);
    
    // Set environment variable temporarily
    const originalDynamoSetting = process.env.USE_DYNAMO_STATE;
    
    if (target === 'file' || target === 'all') {
      process.env.USE_DYNAMO_STATE = 'false';
      await resetState();
      console.log('✅ File state initialized successfully');
    }
    
    if (target === 'dynamo' || target === 'all') {
      process.env.USE_DYNAMO_STATE = 'true';
      await resetState();
      console.log('✅ DynamoDB state initialized successfully');
    }
    
    // Restore original setting
    process.env.USE_DYNAMO_STATE = originalDynamoSetting;
  } catch (error) {
    console.error(`❌ Error initializing state:`, error);
  }
}

/**
 * Synchronize state between storage options
 */
async function syncState(direction = 'toDynamo') {
  try {
    // Enable both storage options temporarily
    const originalDynamoSetting = process.env.USE_DYNAMO_STATE;
    const originalFallbackSetting = process.env.FALLBACK_TO_FILE;
    
    process.env.USE_DYNAMO_STATE = 'true';
    process.env.FALLBACK_TO_FILE = 'true';
    
    await synchronizeState(direction);
    
    // Restore original settings
    process.env.USE_DYNAMO_STATE = originalDynamoSetting;
    process.env.FALLBACK_TO_FILE = originalFallbackSetting;
  } catch (error) {
    console.error('❌ Error synchronizing state:', error);
  }
}

// Command line interface
async function main() {
  const command = process.argv[2]?.toLowerCase();
  
  switch (command) {
    case 'import':
      await importStateToDynamo();
      break;
    case 'export':
      await exportStateFromDynamo();
      break;
    case 'init-file':
      await initializeState('file');
      break;
    case 'init-dynamo':
      await initializeState('dynamo');
      break;
    case 'init-all':
      await initializeState('all');
      break;
    case 'sync-to-dynamo':
      await syncState('toDynamo');
      break;
    case 'sync-to-file':
      await syncState('toFile');
      break;
    case 'test-connections':
      // Set environment variables to test both connections
      process.env.USE_DYNAMO_STATE = 'true';
      process.env.FALLBACK_TO_FILE = 'true';
      
      // Import required modules
      const { loadLastMentionId } = await import('./stateManager.mjs');
      
      // Test connections by trying to load data
      const lastMentionId = await loadLastMentionId();
      console.log(`✅ Connection test complete. Last mention ID: ${lastMentionId || 'None'}`);
      break;
    default:
      console.log(`
Fantasy Top Twitter Bot - State Management Utility

Usage:
  node importState.mjs <command>

Commands:
  import           - Import state from local file to DynamoDB
  export           - Export state from DynamoDB to local file
  init-file        - Initialize local file state with default values
  init-dynamo      - Initialize DynamoDB state with default values
  init-all         - Initialize both file and DynamoDB state
  sync-to-dynamo   - Synchronize state from file to DynamoDB
  sync-to-file     - Synchronize state from DynamoDB to file
  test-connections - Test connections to both storage systems
      `);
  }
}

// Run the CLI
main().catch(console.error);
