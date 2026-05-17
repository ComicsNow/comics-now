const { dbRun, dbGet, dbAll, initializeDatabase, closeDb } = require('./server/db');
const fs = require('fs');
const path = require('path');

async function verify() {
  try {
    console.log('Starting verification...');
    
    // Initialize DB (this will run migrations)
    await initializeDatabase();
    
    // Check if continuousMode column exists in user_reading_preferences
    const cols = await dbAll('PRAGMA table_info(user_reading_preferences)');
    const hasContinuousMode = cols.some(c => c.name === 'continuousMode');
    
    if (hasContinuousMode) {
      console.log('SUCCESS: continuousMode column found in user_reading_preferences');
    } else {
      console.error('FAILURE: continuousMode column NOT found in user_reading_preferences');
      process.exit(1);
    }
    
    // Check if data was migrated (if any exists)
    const prefCount = await dbGet('SELECT COUNT(*) as count FROM user_reading_preferences WHERE continuousMode IS NOT NULL');
    console.log(`Found ${prefCount.count} records with continuousMode in user_reading_preferences`);

    await closeDb();
    console.log('Verification complete.');
  } catch (error) {
    console.error('Verification failed:', error);
    process.exit(1);
  }
}

verify();
