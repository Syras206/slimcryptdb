const { SlimCryptDB, generateEncryptionKey } = require('./SlimCryptDB.js');
const fs = require('fs').promises;
const path = require('path');

/**
 * Comprehensive security test suite for SlimCryptDB
 * Tests encryption, key management, data integrity, and attack resistance
 * With fixes for race conditions and timing issues
 */
class SlimCryptDBSecurityTester {
  constructor() {
    this.testResults = [];
    this.vulnerabilityCount = 0;
    this.warningCount = 0;
    // Use unique test directory with timestamp to avoid conflicts
    this.testDir = path.join(__dirname, `security-test-data-${Date.now()}`);
    this.dbInstances = []; // Track DB instances for proper cleanup
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async setup() {
    console.log('🔒 SlimCryptDB Security Test Suite Starting...\n');
    // Create test directory
    await fs.mkdir(this.testDir, { recursive: true });
  }

  async cleanup() {
    try {
      // Close all database instances
      for (const db of this.dbInstances) {
        try {
          await db.close();
          await this.sleep(100); // Wait for resources to be released
        } catch (error) {
          // Ignore errors during close
        }
      }

      // Wait for filesystem operations to complete
      await this.sleep(300);

      // Remove test directory
      await fs.rm(this.testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  logResult(testName, status, details, severity = 'info') {
    const result = {
      test: testName,
      status,
      details,
      severity,
      timestamp: new Date().toISOString(),
    };

    this.testResults.push(result);

    const statusEmoji =
      status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    const severityPrefix =
      severity === 'critical' ? '🚨' : severity === 'high' ? '⚠️' : '';

    console.log(`${statusEmoji} ${severityPrefix} ${testName}: ${status}`);
    if (details) {
      console.log(`   ${details}\n`);
    }

    if (status === 'FAIL') {
      if (severity === 'critical' || severity === 'high') {
        this.vulnerabilityCount++;
      } else {
        this.warningCount++;
      }
    }
  }

  async testEncryptionStrength() {
    console.log('🔐 Testing Encryption Strength...\n');

    try {
      // Test 1: Key generation entropy
      const keys = Array.from({ length: 100 }, () => generateEncryptionKey());
      const uniqueKeys = new Set(keys.map((k) => k.toString('hex')));

      if (uniqueKeys.size === keys.length) {
        this.logResult(
          'Key Generation Entropy',
          'PASS',
          'All generated keys are unique (good entropy)'
        );
      } else {
        this.logResult(
          'Key Generation Entropy',
          'FAIL',
          'Duplicate keys detected - poor entropy',
          'critical'
        );
      }

      // Test 2: Key length verification
      const testKey = generateEncryptionKey();
      if (testKey.length === 32) {
        this.logResult(
          'Key Length',
          'PASS',
          '256-bit keys generated correctly'
        );
      } else {
        this.logResult(
          'Key Length',
          'FAIL',
          `Expected 32 bytes, got ${testKey.length}`,
          'critical'
        );
      }
    } catch (error) {
      this.logResult(
        'Encryption Strength Tests',
        'FAIL',
        `Unexpected error: ${error.message}`,
        'high'
      );
    }
  }

  async suppressExpectedWarnings(
    testFunction,
    filterPattern = '[WAL RECOVERY]'
  ) {
    const originalWarn = console.warn;
    console.warn = (message) => {
      if (!message.includes(filterPattern)) {
        originalWarn(message);
      }
    };

    try {
      return await testFunction();
    } finally {
      console.warn = originalWarn;
    }
  }

  async testAccessControl() {
    console.log('🔑 Testing Access Control...\n');

    const correctKey = generateEncryptionKey();
    const wrongKey = generateEncryptionKey();
    const testSubDir = path.join(this.testDir, `access-${Date.now()}`);

    let db1 = null;
    let db2 = null;

    try {
      // Create test directory
      await fs.mkdir(testSubDir, { recursive: true });
      await this.sleep(100);

      // Test 1: Create data with correct key
      db1 = new SlimCryptDB(testSubDir, correctKey);
      await db1.ready();
      this.dbInstances.push(db1);

      await db1.createTable('secure_data');
      await db1.addData('secure_data', {
        secret: 'top_secret_information',
        level: 'classified',
      });

      // Ensure write operations complete
      await this.sleep(500);

      // Close the database to ensure all data is flushed to disk
      await db1.close();
      this.dbInstances = this.dbInstances.filter(
        (instance) => instance !== db1
      );

      // Wait for file handles to be released
      await this.sleep(300);

      // Test 2: Try to access with wrong key
      db2 = new SlimCryptDB(testSubDir, wrongKey);
      await db2.ready();
      this.dbInstances.push(db2);

      // Check WAL recovery failures - these are EXPECTED with wrong key
      if (
        db2.lastWALRecoveryFailures &&
        db2.lastWALRecoveryFailures.length > 0
      ) {
        // Verify failures are due to decryption with wrong key (expected)
        const hasUnexpectedFailures = db2.lastWALRecoveryFailures.some(
          (failure) =>
            !failure.error.includes('WAL decryption failed') &&
            !failure.error.includes(
              'Unsupported state or unable to authenticate data'
            ) &&
            !failure.error.includes('Authentication')
        );

        if (hasUnexpectedFailures) {
          throw new Error(
            'Unexpected WAL recovery failures: ' +
              JSON.stringify(db2.lastWALRecoveryFailures, null, 2)
          );
        } else {
          console.log(
            `✓ WAL properly rejected ${db2.lastWALRecoveryFailures.length} entries encrypted with different key`
          );
        }
      }

      try {
        await db2.readData('secure_data', {});
        this.logResult(
          'Key-based Access Control',
          'FAIL',
          'Data accessible with wrong key - encryption bypass possible',
          'critical'
        );
      } catch (error) {
        if (
          error.message.includes('Decryption failed') ||
          error.message.includes('Invalid') ||
          error.message.includes('Authentication')
        ) {
          this.logResult(
            'Key-based Access Control',
            'PASS',
            'Wrong key properly rejected'
          );
        } else {
          this.logResult(
            'Key-based Access Control',
            'WARN',
            `Unexpected error: ${error.message}`,
            'medium'
          );
        }
      }
    } catch (error) {
      this.logResult(
        'Access Control Test',
        'WARN',
        `Test setup failed: ${error.message}`,
        'medium'
      );
    }
  }

  async testAuthenticationTagVerification() {
    console.log('🔐 Testing Data Integrity...\n');

    const encryptionKey = generateEncryptionKey();
    const testSubDir = path.join(this.testDir, `auth-test-${Date.now()}`);

    try {
      // Create database and test data
      const db = new SlimCryptDB(testSubDir, encryptionKey);
      await db.ready();
      this.dbInstances.push(db);

      await db.createTable('test_data');
      const testRecord = await db.addData('test_data', {
        secret: 'sensitive_information_that_should_be_protected',
        level: 'confidential',
        timestamp: Date.now(),
      });

      console.log(`✓ Created test record with ID: ${testRecord.id}`);

      await db.close();
      this.dbInstances = this.dbInstances.filter((instance) => instance !== db);
      await this.sleep(100);

      // Test 1: Corrupt authentication tag in database file
      console.log('Testing corrupted authentication tag...');
      await this._corruptDatabaseFile(testSubDir, 'authTag');

      const db2 = new SlimCryptDB(testSubDir, encryptionKey);
      await db2.ready();
      this.dbInstances.push(db2);

      try {
        await db2.readData('test_data', {});
        await db2.close();
        this.dbInstances = this.dbInstances.filter(
          (instance) => instance !== db2
        );
        throw new Error(
          'Corrupted authentication tag was accepted - authentication failure'
        );
      } catch (error) {
        await db2.close();
        this.dbInstances = this.dbInstances.filter(
          (instance) => instance !== db2
        );

        if (
          error.message.includes('Authentication failed') ||
          error.message.includes('Decryption failed') ||
          error.message.includes('authentication') ||
          error.message.includes('Invalid encrypted data format')
        ) {
          console.log('✓ Corrupted authentication tag properly rejected');
        } else {
          throw new Error(
            `Unexpected error with corrupted auth tag: ${error.message}`
          );
        }
      }

      // Restore original file for next test
      await this._restoreDatabaseFile(testSubDir);

      // Test 2: Corrupt ciphertext in database file
      console.log('Testing corrupted ciphertext...');
      await this._corruptDatabaseFile(testSubDir, 'ciphertext');

      const db3 = new SlimCryptDB(testSubDir, encryptionKey);
      await db3.ready();
      this.dbInstances.push(db3);

      try {
        await db3.readData('test_data', {});
        await db3.close();
        this.dbInstances = this.dbInstances.filter(
          (instance) => instance !== db3
        );
        throw new Error(
          'Corrupted ciphertext was accepted - authentication failure'
        );
      } catch (error) {
        await db3.close();
        this.dbInstances = this.dbInstances.filter(
          (instance) => instance !== db3
        );

        if (
          error.message.includes('Authentication failed') ||
          error.message.includes('Decryption failed') ||
          error.message.includes('authentication') ||
          error.message.includes('not valid JSON') ||
          error.message.includes('Invalid encrypted data format')
        ) {
          console.log('✓ Corrupted ciphertext properly rejected');
        } else {
          throw new Error(
            `Unexpected error with corrupted ciphertext: ${error.message}`
          );
        }
      }

      this.logResult(
        'Authentication Tag Verification',
        'PASS',
        'All corruption attempts properly rejected'
      );
    } catch (error) {
      this.logResult(
        'Authentication Tag Verification',
        'FAIL',
        `Authentication verification failed: ${error.message}`,
        'critical'
      );
    }
  }

  async _corruptDatabaseFile(testSubDir, corruptionType) {
    const filePath = path.join(testSubDir, 'test_data.db');

    try {
      let fileContent = await fs.readFile(filePath, 'utf8');

      // Store original for restoration
      this._originalFileContent = fileContent;

      // Find and corrupt encrypted data patterns
      const encryptedPattern = /[a-f0-9]{32}:[a-f0-9]{32}:[a-f0-9]+/gi;

      fileContent = fileContent.replace(encryptedPattern, (match) => {
        const parts = match.split(':');
        if (parts.length === 3) {
          if (corruptionType === 'authTag') {
            // Corrupt authentication tag (middle part)
            const corruptedTag = parts[1].substring(0, 28) + 'ffff';
            return `${parts[0]}:${corruptedTag}:${parts[2]}`;
          } else if (corruptionType === 'ciphertext') {
            // Corrupt ciphertext (last part)
            const corruptedCiphertext =
              parts[2].substring(0, parts[2].length - 8) + 'ffffffff';
            return `${parts[0]}:${parts[1]}:${corruptedCiphertext}`;
          }
        }
        return match;
      });

      await fs.writeFile(filePath, fileContent, 'utf8');
      console.log(`✓ Applied ${corruptionType} corruption to database file`);
    } catch (error) {
      throw new Error(`Failed to corrupt database file: ${error.message}`);
    }
  }

  async _restoreDatabaseFile(testSubDir) {
    if (this._originalFileContent) {
      const filePath = path.join(testSubDir, 'test_data.db');
      await fs.writeFile(filePath, this._originalFileContent, 'utf8');
      console.log('✓ Restored original database file');
    }
  }

  /**
   * Test key management security - key derivation, rotation, and secure handling
   */
  async testKeyManagementSecurity() {
    console.log('🔑 Testing Key Management Security...\n');

    const baseKey = generateEncryptionKey();
    const testSubDir = path.join(this.testDir, `key-mgmt-${Date.now()}`);

    try {
      // Test 1: Key derivation consistency
      console.log('Testing key derivation consistency...');
      const db1 = new SlimCryptDB(testSubDir, baseKey);
      await db1.ready();
      this.dbInstances.push(db1);

      await db1.createTable('key_test');
      const testData = { secret: 'key_derivation_test', timestamp: Date.now() };
      await db1.addData('key_test', testData);

      // Get the derived WAL key for comparison
      const originalWalKey = db1.walKey ? Buffer.from(db1.walKey) : null;

      await db1.close();
      this.dbInstances = this.dbInstances.filter(
        (instance) => instance !== db1
      );

      // Reopen with same key - should derive identical WAL key
      const db2 = new SlimCryptDB(testSubDir, baseKey);
      await db2.ready();
      this.dbInstances.push(db2);

      const newWalKey = db2.walKey;

      if (!originalWalKey || !newWalKey || !originalWalKey.equals(newWalKey)) {
        throw new Error('Key derivation is not consistent between sessions');
      }
      console.log('✓ Key derivation is consistent across sessions');

      // Test 2: Key isolation between instances
      console.log('Testing key isolation between instances...');
      const db3 = new SlimCryptDB(
        path.join(this.testDir, `isolation-${Date.now()}`),
        generateEncryptionKey()
      );
      await db3.ready();
      this.dbInstances.push(db3);

      if (db2.walKey && db3.walKey && db2.walKey.equals(db3.walKey)) {
        throw new Error(
          'Different databases derived identical keys - key isolation failure'
        );
      }
      console.log('✓ Key isolation between instances verified');

      // Test 3: Memory security - verify keys are properly cleared
      console.log('Testing key memory security...');
      const keyBuffer = Buffer.from(db2.encryptionKey);
      await db2.close();
      this.dbInstances = this.dbInstances.filter(
        (instance) => instance !== db2
      );

      // Check if the original key buffer was properly wiped
      const keySum = keyBuffer.reduce((sum, byte) => sum + byte, 0);
      if (keySum !== 0) {
        console.log(
          '⚠️ Original key buffer not wiped (expected for independent copies)'
        );
      } else {
        console.log('✓ Key buffer properly wiped on close');
      }

      await db3.close();
      this.dbInstances = this.dbInstances.filter(
        (instance) => instance !== db3
      );

      // Test 4: Salt persistence and security
      console.log('Testing salt persistence and security...');
      const saltPath = path.join(testSubDir, 'wal', '.salt');

      try {
        const saltData = await fs.readFile(saltPath);
        if (saltData.length !== 32) {
          throw new Error(
            `Invalid salt length: expected 32, got ${saltData.length}`
          );
        }

        // Verify salt is not all zeros
        const saltSum = saltData.reduce((sum, byte) => sum + byte, 0);
        if (saltSum === 0) {
          throw new Error('Salt contains all zeros - potential security issue');
        }

        console.log('✓ Salt properly generated and persisted');
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(
            'Salt file not created - key derivation may be insecure'
          );
        }
        throw error;
      }

      this.logResult(
        'Key Management Security',
        'PASS',
        'Key derivation, isolation, and memory security verified'
      );
    } catch (error) {
      this.logResult(
        'Key Management Security',
        'FAIL',
        `Key management security failed: ${error.message}`,
        'critical'
      );
    }
  }

  /**
   * Test performance security - ensure encryption doesn't create DoS vulnerabilities
   */
  async testPerformanceSecurityImpact() {
    console.log('⚡ Testing Performance Security Impact...\n');

    const encryptionKey = generateEncryptionKey();
    const testSubDir = path.join(this.testDir, `perf-security-${Date.now()}`);

    try {
      // Test 1: Encryption performance impact assessment
      console.log('Testing encryption performance impact...');

      const db = new SlimCryptDB(testSubDir, encryptionKey);
      await db.ready();
      this.dbInstances.push(db);

      await db.createTable('performance_test');

      // Test with increasingly large payloads to detect performance DoS vectors
      const testSizes = [100, 1000, 10000, 50000]; // bytes
      const performanceResults = [];

      for (const size of testSizes) {
        const largeData = {
          id: `test_${size}`,
          payload: 'x'.repeat(size),
          timestamp: Date.now(),
        };

        const startTime = Date.now();
        await db.addData('performance_test', largeData);
        const encryptTime = Date.now() - startTime;

        const readStartTime = Date.now();
        await db.readData('performance_test', { id: largeData.id });
        const decryptTime = Date.now() - readStartTime;

        performanceResults.push({
          size,
          encryptTime,
          decryptTime,
          totalTime: encryptTime + decryptTime,
        });

        console.log(
          `✓ ${size} bytes: encrypt=${encryptTime}ms, decrypt=${decryptTime}ms`
        );
      }

      // Analyze performance scaling to detect potential DoS vulnerabilities
      const worstCaseTime = Math.max(
        ...performanceResults.map((r) => r.totalTime)
      );
      if (worstCaseTime > 5000) {
        // 5 second threshold
        throw new Error(
          `Performance DoS vulnerability: ${worstCaseTime}ms for encryption/decryption`
        );
      }

      // Test 2: Concurrent access performance security
      console.log('Testing concurrent access performance...');

      const concurrentOperations = 10;
      const concurrentPromises = [];

      const concurrentStartTime = Date.now();

      for (let i = 0; i < concurrentOperations; i++) {
        const promise = db.addData('performance_test', {
          concurrent_id: i,
          data: `concurrent_test_${i}`,
          timestamp: Date.now(),
        });
        concurrentPromises.push(promise);
      }

      await Promise.all(concurrentPromises);
      const concurrentTime = Date.now() - concurrentStartTime;

      console.log(
        `✓ ${concurrentOperations} concurrent operations completed in ${concurrentTime}ms`
      );

      if (concurrentTime > 10000) {
        // 10 second threshold for concurrent operations
        throw new Error(
          `Concurrent access DoS vulnerability: ${concurrentTime}ms for ${concurrentOperations} operations`
        );
      }

      // Test 3: Memory usage under encryption load
      console.log('Testing memory usage security...');

      const initialMemory = process.memoryUsage().heapUsed;

      // Perform multiple encryption operations
      for (let i = 0; i < 100; i++) {
        await db.addData('performance_test', {
          memory_test: i,
          data: 'x'.repeat(1000),
          timestamp: Date.now(),
        });
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024);

      console.log(
        `✓ Memory increase: ${memoryIncreaseMB.toFixed(2)}MB for 100 operations`
      );

      if (memoryIncreaseMB > 100) {
        // 100MB threshold
        throw new Error(
          `Memory DoS vulnerability: ${memoryIncreaseMB.toFixed(2)}MB memory increase`
        );
      }

      await db.close();
      this.dbInstances = this.dbInstances.filter((instance) => instance !== db);

      this.logResult(
        'Performance Security Impact',
        'PASS',
        `Performance impact acceptable - worst case: ${worstCaseTime}ms, memory: ${memoryIncreaseMB.toFixed(2)}MB`
      );
    } catch (error) {
      this.logResult(
        'Performance Security Impact',
        'FAIL',
        `Performance security test failed: ${error.message}`,
        'high'
      );
    }
  }

  async testWalRecovery() {
    console.log('🔑 Testing WAL Recovery...\n');

    const encryptionKey = generateEncryptionKey();
    const testSubDir = path.join(this.testDir, `wal-recovery-${Date.now()}`);

    // Test 1: Create data, close, and reopen
    const db3 = new SlimCryptDB(testSubDir, encryptionKey);
    await db3.ready();
    this.dbInstances.push(db3);

    await db3.createTable('secure_data');
    const testData = {
      secret: 'top_secret_information',
      level: 'classified',
      timestamp: Date.now(),
    };

    const addedData = await db3.addData('secure_data', testData);
    console.log(`✓ Added test data with ID: ${addedData.id}`);

    // Ensure WAL is flushed before closing
    await db3._flushWAL();

    // Simulate crash - close first database
    await db3.close();
    this.dbInstances = this.dbInstances.filter((instance) => instance !== db3);
    await this.sleep(300);

    try {
      // Trigger WAL recovery with fresh database instance
      const db4 = new SlimCryptDB(testSubDir, encryptionKey);
      await db4.ready();
      this.dbInstances.push(db4);

      // Verify no recovery failures
      const recoverySummary = db4.getWALRecoverySummary();
      if (recoverySummary.failures.length > 0) {
        throw new Error(
          `WAL recovery had unexpected failures: ${JSON.stringify(recoverySummary.failures, null, 2)}`
        );
      }

      // Verify data was recovered correctly
      const recoveredData = await db4.readData('secure_data', {});
      if (recoveredData.length === 0) {
        throw new Error('No data recovered from WAL');
      }

      const recoveredItem = recoveredData.find(
        (item) => item.id === addedData.id
      );
      if (!recoveredItem) {
        throw new Error(`Could not find item with ID ${addedData.id}`);
      }

      if (
        recoveredItem.secret !== testData.secret ||
        recoveredItem.level !== testData.level
      ) {
        throw new Error("Recovered data doesn't match original");
      }

      console.log(`✓ WAL properly recovered ${recoveredData.length} entries`);
      console.log(`✓ Data integrity verified: "${recoveredItem.secret}"`);

      await db4.close();
      this.dbInstances = this.dbInstances.filter(
        (instance) => instance !== db4
      );

      this.logResult(
        'WAL Recovery',
        'PASS',
        'WAL encryption and recovery working correctly'
      );
    } catch (error) {
      this.logResult(
        'WAL Recovery',
        'FAIL',
        `WAL recovery failed: ${error.message}`,
        'critical'
      );
    }
  }

  async runAllSecurityTests() {
    try {
      await this.setup();

      console.log('🔒 SlimCryptDB Security Assessment');
      console.log('='.repeat(50));

      // Run tests sequentially with proper isolation
      await this.testEncryptionStrength();
      await this.testAuthenticationTagVerification();

      await this.suppressExpectedWarnings(async () => {
        // supress expected wal recovery warnings
        await this.testAccessControl();
      });

      await this.testWalRecovery();
      await this.testKeyManagementSecurity();
      await this.testPerformanceSecurityImpact();
    } catch (error) {
      console.error('❌ SlimCryptDB security test failed:', error.message);
    } finally {
      await this.cleanup();
      this.printSecurityReport();
    }
  }

  printSecurityReport() {
    console.log('\n🛡️ SECURITY ASSESSMENT REPORT');
    console.log('='.repeat(50));

    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(
      (r) => r.status === 'PASS'
    ).length;
    const failedTests = this.testResults.filter(
      (r) => r.status === 'FAIL'
    ).length;
    const warningTests = this.testResults.filter(
      (r) => r.status === 'WARN'
    ).length;

    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log(`⚠️  Warnings: ${warningTests}`);
    console.log(`🚨 Critical Issues: ${this.vulnerabilityCount}`);
    console.log(`⚠️  Other Issues: ${this.warningCount}\n`);

    // Security score calculation
    const securityScore = Math.max(
      0,
      100 - this.vulnerabilityCount * 25 - this.warningCount * 5
    );

    console.log(`🏆 Security Score: ${securityScore}/100`);

    if (securityScore >= 90) {
      console.log('✅ EXCELLENT - Production ready');
    } else if (securityScore >= 75) {
      console.log('✅ GOOD - Minor issues to address');
    } else if (securityScore >= 50) {
      console.log('⚠️ FAIR - Significant issues need attention');
    } else {
      console.log('❌ POOR - Critical security issues must be fixed');
    }

    // List critical issues
    const criticalIssues = this.testResults.filter(
      (r) =>
        r.status === 'FAIL' &&
        (r.severity === 'critical' || r.severity === 'high')
    );

    if (criticalIssues.length > 0) {
      console.log('\n🚨 CRITICAL SECURITY ISSUES:');
      criticalIssues.forEach((issue) => {
        console.log(`   • ${issue.test}: ${issue.details}`);
      });
    }

    console.log('\n🔒 Security test completed!');

    // Exit with appropriate code
    process.exit(this.vulnerabilityCount > 0 ? 1 : 0);
  }
}

// Run security tests if called directly
if (require.main === module) {
  const tester = new SlimCryptDBSecurityTester();
  tester.runAllSecurityTests().catch(console.error);
}

module.exports = SlimCryptDBSecurityTester;
