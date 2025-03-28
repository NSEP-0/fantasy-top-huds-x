/**
 * migrateState.mjs - Migration utility for the state file format
 * 
 * This script helps migrate from the old state format to the new one,
 * preserving all important data while adding the new structure.
 */
import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState, resetState } from '../stateManager.mjs';

/**
 * Runs the migration process interactively
 */
async function runMigration() {
  console.log('🔄 State File Migration Tool');
  console.log('============================\n');
  
  try {
    // Check if we already have the new format
    console.log('Step 1: Loading current state...');
    const currentState = await loadState();
    
    if (currentState.metadata && 
        currentState.twitter && 
        currentState.replies) {
      console.log('✅ Your state file is already in the new format. No migration needed.');
      
      // Ask if they want to view the current state
      const readline = (await import('readline')).default;
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.question('\nDo you want to view the current state? (y/n): ', async (answer) => {
        if (answer.toLowerCase() === 'y') {
          console.log('\nCurrent State:');
          console.log(JSON.stringify(currentState, null, 2));
        }
        
        rl.question('\nDo you want to reset to a fresh state? (y/n): ', async (answer) => {
          if (answer.toLowerCase() === 'y') {
            console.log('\nResetting state...');
            await resetState();
            console.log('✅ State has been reset to defaults.');
            
            // Check if the user wants to preserve lastMentionId
            rl.question('\nDo you want to keep the existing lastMentionId? (y/n): ', async (answer) => {
              if (answer.toLowerCase() === 'y' && currentState.twitter.lastMentionId) {
                const resetState = await loadState();
                resetState.twitter.lastMentionId = currentState.twitter.lastMentionId;
                await saveState(resetState);
                console.log(`✅ Preserved lastMentionId: ${currentState.twitter.lastMentionId}`);
              }
              rl.close();
              console.log('\nMigration tool complete. You can now run your bot with the new state format.');
            });
          } else {
            rl.close();
            console.log('\nNo changes made. Migration tool complete.');
          }
        });
      });
    } else {
      console.log('🔄 Need to migrate from old format to new format.');
      console.log('Step 2: Creating backup of existing state...');
      
      // Create backup
      try {
        const stateDir = process.env.STATE_DIR || process.cwd();
        const stateFile = process.env.STATE_FILE || 'state.json';
        const stateFilePath = path.join(stateDir, stateFile);
        const backupFile = `${stateFilePath}.backup.${Date.now()}.json`;
        
        await fs.copyFile(stateFilePath, backupFile);
        console.log(`✅ Backup created at: ${backupFile}`);
      } catch (backupError) {
        console.warn(`⚠️ Couldn't create backup: ${backupError.message}`);
      }
      
      console.log('Step 3: Running migration...');
      // The loadState function has already migrated the data
      console.log('Step 4: Saving migrated state...');
      await saveState(currentState);
      
      console.log('✅ Migration completed successfully!');
      console.log('\nNew state structure:');
      console.log(JSON.stringify({
        metadata: currentState.metadata,
        twitter: {
          lastMentionId: currentState.twitter.lastMentionId,
          processedCount: currentState.twitter.processedCount
        },
        replies: {
          count: currentState.replies.count,
          byHero: Object.keys(currentState.replies.byHero || {}).length + ' heroes',
          history: Object.keys(currentState.replies.history || {}).length + ' tweets'
        }
      }, null, 2));
      
      console.log('\nMigration tool complete. You can now run your bot with the new state format.');
    }
  } catch (error) {
    console.error('❌ Error during migration:', error);
    console.log('\nIf the error persists, you may want to manually delete the state.json file and start fresh.');
  }
}

// Run the migration
runMigration().catch(console.error);
