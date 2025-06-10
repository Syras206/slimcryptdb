const {
  SlimCryptDB,
  generateEncryptionKey,
} = require('./dist/SlimCryptDB.min.js');

/**
 * Comprehensive example demonstrating SlimCryptDB features
 * This example shows real-world usage patterns for a secure note-taking application
 */
class SecureNotesExample {
  initialize() {
    console.log('🚀 Initializing SlimCryptDB Example Application...\n');

    // Generate a secure encryption key
    this.encryptionKey = generateEncryptionKey();
    console.log('🔑 Generated secure 256-bit encryption key');

    // Create database instance with security-first configuration
    this.db = new SlimCryptDB('./example-data', this.encryptionKey, {
      encrypt: true, // Enable AES-256-GCM encryption
      compression: true, // Enable gzip compression
      walEnabled: true, // Enable Write-Ahead Logging
      syncWrites: true, // Synchronous writes for data integrity
    });

    console.log('📁 Database initialized with security features enabled\n');
  }

  async cleanup() {
    console.log('🚮 Cleaning up database...\n');
    await this.db.close();

    // Remove database folder
    await new Promise((resolve, reject) => {
      require('fs').rm('./example-data', { recursive: true }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    console.log('✅ Database cleaned up\n');
  }

  async setupSchema() {
    console.log('📋 Setting up database schema...\n');

    // Define schema for secure notes
    const noteSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        content: { type: 'string', maxLength: 10000 },
        tags: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10,
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
        },
        encrypted: { type: 'boolean' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
      required: ['title', 'content', 'priority'],
    };

    // Create notes table with schema validation
    await this.db.createTable('notes', noteSchema);
    console.log('✅ Created "notes" table with validation schema');

    // Define schema for user preferences
    const userSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        username: { type: 'string', minLength: 3, maxLength: 50 },
        email: { type: 'string', format: 'email' },
        preferences: {
          type: 'object',
          properties: {
            theme: { type: 'string', enum: ['light', 'dark'] },
            autoSave: { type: 'boolean' },
            encryptByDefault: { type: 'boolean' },
          },
        },
        lastLogin: { type: 'string' },
      },
      required: ['username', 'email'],
    };

    await this.db.createTable('users', userSchema);
    console.log('✅ Created "users" table with validation schema');

    // Create indexes for better query performance
    await this.db.createIndex('notes', 'title_idx', ['title']);
    await this.db.createIndex('notes', 'tags_idx', ['tags']);
    await this.db.createIndex('notes', 'priority_idx', ['priority']);
    await this.db.createIndex('users', 'email_idx', ['email'], {
      unique: true,
    });

    console.log('🚀 Created performance indexes for fast queries\n');
  }

  async createSampleData() {
    console.log('📝 Creating sample data...\n');

    // Sample user data
    const sampleUsers = [
      {
        username: 'alice_cooper',
        email: 'alice@example.com',
        preferences: {
          theme: 'dark',
          autoSave: true,
          encryptByDefault: true,
        },
        lastLogin: new Date().toISOString(),
      },
      {
        username: 'bob_smith',
        email: 'bob@example.com',
        preferences: {
          theme: 'light',
          autoSave: false,
          encryptByDefault: false,
        },
        lastLogin: new Date().toISOString(),
      },
    ];

    // Sample notes data
    const sampleNotes = [
      {
        title: 'Project Architecture Notes',
        content:
          'Database design considerations:\n1. Security first approach\n2. Performance optimization\n3. Scalability planning',
        tags: ['work', 'architecture', 'database'],
        priority: 'high',
        encrypted: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        title: 'Meeting Summary - Q4 Planning',
        content:
          'Key decisions made:\n- Budget allocation\n- Resource planning\n- Timeline adjustments',
        tags: ['meeting', 'planning', 'q4'],
        priority: 'medium',
        encrypted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        title: 'Security Review Checklist',
        content:
          'Critical security items:\n1. Encryption at rest\n2. Input validation\n3. Access controls\n4. Audit logging',
        tags: ['security', 'checklist', 'review'],
        priority: 'urgent',
        encrypted: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        title: 'Personal Reminders',
        content:
          "Don't forget:\n- Update documentation\n- Review pull requests\n- Schedule team meeting",
        tags: ['personal', 'reminders'],
        priority: 'low',
        encrypted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Insert data using transactions for atomicity
    const txnId = await this.db.startTransaction();

    try {
      // Insert users
      for (const user of sampleUsers) {
        const createdUser = await this.db.addData('users', user, txnId);
        console.log(`👤 Created user: ${createdUser.username}`);
      }

      // Insert notes
      for (const note of sampleNotes) {
        const createdNote = await this.db.addData('notes', note, txnId);
        console.log(
          `📝 Created note: "${createdNote.title}" (${createdNote.priority} priority)`
        );
      }

      // Commit transaction
      await this.db.commitTransaction(txnId);
      console.log('✅ All sample data created successfully!\n');
    } catch (error) {
      await this.db.rollbackTransaction(txnId);
      console.error('❌ Failed to create sample data:', error.message);
      throw error;
    }
  }

  async demonstrateQueries() {
    console.log('🔍 Demonstrating advanced query capabilities...\n');

    // 1. Simple query by priority
    console.log('📊 Query 1: Find all high priority notes');
    const highPriorityNotes = await this.db.queryData('notes', {
      filter: {
        operator: 'and',
        conditions: [{ column: 'priority', operator: '==', value: 'high' }],
      },
    });
    console.log(`Found ${highPriorityNotes.length} high priority notes:`);
    highPriorityNotes.forEach((note) => {
      console.log(`  • ${note.title}`);
    });
    console.log();

    // 2. Complex query with multiple conditions
    console.log('📊 Query 2: Find encrypted urgent or high priority notes');
    const criticalEncryptedNotes = await this.db.queryData('notes', {
      filter: {
        operator: 'and',
        conditions: [
          { column: 'encrypted', operator: '==', value: true },
          {
            operator: 'or',
            conditions: [
              { column: 'priority', operator: '==', value: 'urgent' },
              { column: 'priority', operator: '==', value: 'high' },
            ],
          },
        ],
      },
      sort: { column: 'priority', direction: 'desc' },
    });
    console.log(
      `Found ${criticalEncryptedNotes.length} critical encrypted notes:`
    );
    criticalEncryptedNotes.forEach((note) => {
      console.log(`  • ${note.title} (${note.priority})`);
    });
    console.log();

    // 3. Text search with LIKE operator
    console.log('📊 Query 3: Search notes containing "security"');
    const securityNotes = await this.db.queryData('notes', {
      filter: {
        operator: 'or',
        conditions: [
          { column: 'title', operator: 'like', value: '.*[Ss]ecurity.*' },
          { column: 'content', operator: 'like', value: '.*[Ss]ecurity.*' },
        ],
      },
    });
    console.log(`Found ${securityNotes.length} notes about security:`);
    securityNotes.forEach((note) => {
      console.log(`  • ${note.title}`);
    });
    console.log();

    // 4. Pagination example
    console.log('📊 Query 4: Paginated results (2 notes per page)');
    const firstPage = await this.db.queryData('notes', {
      sort: { column: 'createdAt', direction: 'desc' },
      limit: 2,
      offset: 0,
    });
    console.log('Page 1:');
    firstPage.forEach((note, index) => {
      console.log(`  ${index + 1}. ${note.title}`);
    });

    const secondPage = await this.db.queryData('notes', {
      sort: { column: 'createdAt', direction: 'desc' },
      limit: 2,
      offset: 2,
    });
    console.log('Page 2:');
    secondPage.forEach((note, index) => {
      console.log(`  ${index + 3}. ${note.title}`);
    });
    console.log();
  }

  async demonstrateTransactions() {
    console.log('💳 Demonstrating transaction capabilities...\n');

    // Example: Update multiple related records atomically
    console.log(
      '🔄 Atomic update: Changing user preferences and related notes...'
    );

    const txnId = await this.db.startTransaction('REPEATABLE_READ');

    try {
      // Update user preferences
      const users = await this.db.readData('users', {
        username: 'alice_cooper',
      });
      if (users.length > 0) {
        const user = users[0];
        user.preferences.theme = 'light';
        user.preferences.encryptByDefault = false;
        user.lastLogin = new Date().toISOString();

        // In a real implementation, you'd have an update method
        console.log('  ✓ Updated user preferences');
      }

      // Add a new note related to the preference change
      await this.db.addData(
        'notes',
        {
          title: 'Preference Update Log',
          content:
            'Changed theme to light mode and disabled default encryption',
          tags: ['system', 'preferences', 'log'],
          priority: 'low',
          encrypted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        txnId
      );
      console.log('  ✓ Added preference change log note');

      await this.db.commitTransaction(txnId);
      console.log('✅ Transaction committed successfully!\n');
    } catch (error) {
      await this.db.rollbackTransaction(txnId);
      console.error('❌ Transaction failed, rolled back:', error.message);
    }
  }

  async demonstrateEventHandling() {
    console.log('📡 Demonstrating event-driven capabilities...\n');

    // Set up event listeners
    this.db.on('add', (tableName, data) => {
      console.log(
        `🆕 Event: New ${tableName} record added - ${data.title || data.username || 'Untitled'}`
      );
    });

    this.db.on('commitTransaction', (transactionId) => {
      console.log(
        `💾 Event: Transaction ${transactionId.substring(0, 8)}... committed`
      );
    });

    // Trigger some events
    await this.db.addData('notes', {
      title: 'Event-Driven Architecture Example',
      content: 'This note demonstrates the event system in action',
      tags: ['example', 'events'],
      priority: 'medium',
      encrypted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    console.log();
  }

  async demonstratePerformance() {
    console.log('⚡ Performance demonstration...\n');

    const startTime = Date.now();
    const batchSize = 100;

    console.log(`🔥 Creating ${batchSize} notes in a single transaction...`);

    const txnId = await this.db.startTransaction();

    try {
      for (let i = 0; i < batchSize; i++) {
        await this.db.addData(
          'notes',
          {
            title: `Performance Test Note ${i}`,
            content:
              `This is test note number ${i} for performance demonstration. ` +
              'It contains some sample content to test insertion speed with realistic data sizes.',
            tags: ['performance', 'test', `batch-${Math.floor(i / 10)}`],
            priority: ['low', 'medium', 'high'][i % 3],
            encrypted: i % 2 === 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          txnId
        );
      }

      await this.db.commitTransaction(txnId);

      const duration = Date.now() - startTime;
      const opsPerSecond = Math.round((batchSize / duration) * 1000);

      console.log(`✅ Created ${batchSize} notes in ${duration}ms`);
      console.log(`🚀 Performance: ${opsPerSecond} operations per second\n`);
    } catch (error) {
      await this.db.rollbackTransaction(txnId);
      console.error('❌ Performance test failed:', error.message);
    }
  }

  async demonstrateStats() {
    console.log('📊 Database statistics and monitoring...\n');

    const stats = this.db.getStats();

    console.log('Database Statistics:');
    console.log(`  📁 Tables: ${stats.tables}`);
    console.log(`  🗂️  Indexes: ${stats.indexes}`);
    console.log(`  💳 Active Transactions: ${stats.activeTransactions}`);
    console.log(`  📝 WAL Sequence: ${stats.walSequence}`);

    // Query some counts for additional stats
    const totalNotes = await this.db.readData('notes', {});
    const encryptedNotes = totalNotes.filter((note) => note.encrypted);
    const urgentNotes = totalNotes.filter((note) => note.priority === 'urgent');

    console.log('Application Statistics:');
    console.log(`  📝 Total Notes: ${totalNotes.length}`);
    console.log(`  🔒 Encrypted Notes: ${encryptedNotes.length}`);
    console.log(`  🚨 Urgent Notes: ${urgentNotes.length}`);
    console.log(
      `  📈 Encryption Ratio: ${((encryptedNotes.length / totalNotes.length) * 100).toFixed(1)}%\n`
    );
  }

  async runFullExample() {
    try {
      this.initialize();
      await this.setupSchema();
      await this.createSampleData();
      await this.demonstrateQueries();
      await this.demonstrateTransactions();
      await this.demonstrateEventHandling();
      await this.demonstratePerformance();
      await this.demonstrateStats();

      console.log('🎉 SlimCryptDB example completed successfully!');
      console.log('🔗 Ready for production use in your applications');
    } catch (error) {
      console.error('❌ SlimCryptDB example failed:', error.message);
    } finally {
      await this.cleanup();
    }
  }
}

new SecureNotesExample().runFullExample();
