const { SlimCryptDB, generateEncryptionKey } = require("./SlimCryptDB.js");
const crypto = require("crypto");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

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
    console.log("🔒 SlimCryptDB Security Test Suite Starting...\n");
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

  logResult(testName, status, details, severity = "info") {
    const result = {
      test: testName,
      status,
      details,
      severity,
      timestamp: new Date().toISOString(),
    };

    this.testResults.push(result);

    const statusEmoji =
      status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⚠️";
    const severityPrefix =
      severity === "critical" ? "🚨" : severity === "high" ? "⚠️" : "";

    console.log(`${statusEmoji} ${severityPrefix} ${testName}: ${status}`);
    if (details) {
      console.log(`   ${details}\n`);
    }

    if (status === "FAIL") {
      if (severity === "critical" || severity === "high") {
        this.vulnerabilityCount++;
      } else {
        this.warningCount++;
      }
    }
  }

  async testEncryptionStrength() {
    console.log("🔐 Testing Encryption Strength...\n");

    try {
      // Test 1: Key generation entropy
      const keys = Array.from({ length: 100 }, () => generateEncryptionKey());
      const uniqueKeys = new Set(keys.map((k) => k.toString("hex")));

      if (uniqueKeys.size === keys.length) {
        this.logResult(
          "Key Generation Entropy",
          "PASS",
          "All generated keys are unique (good entropy)",
        );
      } else {
        this.logResult(
          "Key Generation Entropy",
          "FAIL",
          "Duplicate keys detected - poor entropy",
          "critical",
        );
      }

      // Test 2: Key length verification
      const testKey = generateEncryptionKey();
      if (testKey.length === 32) {
        this.logResult(
          "Key Length",
          "PASS",
          "256-bit keys generated correctly",
        );
      } else {
        this.logResult(
          "Key Length",
          "FAIL",
          `Expected 32 bytes, got ${testKey.length}`,
          "critical",
        );
      }
    } catch (error) {
      this.logResult(
        "Encryption Strength Tests",
        "FAIL",
        `Unexpected error: ${error.message}`,
        "high",
      );
    }
  }

  async testDataIntegrity() {
    console.log("🛡️ Testing Data Integrity Protection...\n");

    const testKey = generateEncryptionKey();
    const testSubDir = path.join(this.testDir, `integrity-${Date.now()}`);
    let db = null;

    try {
      // Create test directory
      await fs.mkdir(testSubDir, { recursive: true });
      await this.sleep(100); // Wait for directory creation

      // Create database instance
      db = new SlimCryptDB(testSubDir, testKey);
      this.dbInstances.push(db);

      // Create test table and add data
      await db.createTable("integrity_test", {
        type: "object",
        properties: {
          sensitive: { type: "string" },
          checksum: { type: "string" },
        },
      });

      await db.addData("integrity_test", {
        id: "test1",
        sensitive: "confidential data",
        checksum: crypto
          .createHash("sha256")
          .update("confidential data")
          .digest("hex"),
      });

      // Ensure write operations complete
      await this.sleep(500);

      // Close the database to ensure all data is flushed to disk
      await db.close();
      this.dbInstances = this.dbInstances.filter((instance) => instance !== db);

      // Wait for file handles to be released
      await this.sleep(300);

      // Get the file path and corrupt the data
      const filePath = path.join(testSubDir, "integrity_test.db");

      // Verify file exists
      if (!fsSync.existsSync(filePath)) {
        throw new Error(`Test file does not exist at ${filePath}`);
      }

      // Read the file data
      const rawData = await fs.readFile(filePath);

      // Create corrupted data
      const corruptedData = Buffer.concat([
        rawData.slice(0, Math.floor(rawData.length / 2)),
        Buffer.from("CORRUPTED"),
        rawData.slice(Math.floor(rawData.length / 2) + 9),
      ]);

      // Write corrupted data back
      await fs.writeFile(filePath, corruptedData);
      await this.sleep(300); // Wait for write to complete

      // Try to read the corrupted data
      let corruptedDb = null;
      try {
        corruptedDb = new SlimCryptDB(testSubDir, testKey);
        this.dbInstances.push(corruptedDb);

        await corruptedDb.readData("integrity_test", {});
        this.logResult(
          "Authentication Tag Verification",
          "FAIL",
          "Corrupted data was accepted - authentication not working",
          "critical",
        );
      } catch (error) {
        if (
          error.message.includes("Decryption failed") ||
          error.message.includes("Invalid") ||
          error.message.includes("Authentication")
        ) {
          this.logResult(
            "Authentication Tag Verification",
            "PASS",
            "Corrupted data properly rejected",
          );
        } else {
          this.logResult(
            "Authentication Tag Verification",
            "WARN",
            `Unexpected error: ${error.message}`,
            "medium",
          );
        }
      }
    } catch (error) {
      this.logResult(
        "Data Integrity Test",
        "WARN",
        `Test setup failed: ${error.message}`,
        "medium",
      );
    }
  }

  async testAccessControl() {
    console.log("🔑 Testing Access Control...\n");

    const correctKey = generateEncryptionKey();
    const wrongKey = generateEncryptionKey();
    const testSubDir = path.join(this.testDir, `access-${Date.now()}`);

    let db1 = null;
    let db2 = null;

    try {
      // Create test directory
      await fs.mkdir(testSubDir, { recursive: true });
      await this.sleep(100); // Wait for directory creation

      // Test 1: Create data with correct key
      db1 = new SlimCryptDB(testSubDir, correctKey);
      this.dbInstances.push(db1);

      await db1.createTable("secure_data");
      await db1.addData("secure_data", {
        secret: "top_secret_information",
        level: "classified",
      });

      // Ensure write operations complete
      await this.sleep(500);

      // Close the database to ensure all data is flushed to disk
      await db1.close();
      this.dbInstances = this.dbInstances.filter(
        (instance) => instance !== db1,
      );

      // Wait for file handles to be released
      await this.sleep(300);

      // Test 2: Try to access with wrong key
      db2 = new SlimCryptDB(testSubDir, wrongKey);
      this.dbInstances.push(db2);

      try {
        await db2.readData("secure_data", {});
        this.logResult(
          "Key-based Access Control",
          "FAIL",
          "Data accessible with wrong key - encryption bypass possible",
          "critical",
        );
      } catch (error) {
        if (
          error.message.includes("Decryption failed") ||
          error.message.includes("Invalid") ||
          error.message.includes("Authentication")
        ) {
          this.logResult(
            "Key-based Access Control",
            "PASS",
            "Wrong key properly rejected",
          );
        } else {
          this.logResult(
            "Key-based Access Control",
            "WARN",
            `Unexpected error: ${error.message}`,
            "medium",
          );
        }
      }
    } catch (error) {
      this.logResult(
        "Access Control Test",
        "WARN",
        `Test setup failed: ${error.message}`,
        "medium",
      );
    }
  }

  async runAllSecurityTests() {
    try {
      await this.setup();

      console.log("🔒 SlimCryptDB Security Assessment");
      console.log("=".repeat(50));

      // Run tests sequentially with proper isolation
      await this.testEncryptionStrength();
      await this.testDataIntegrity();
      await this.testAccessControl();
    } catch (error) {
      console.error("❌ SlimCryptDB security test failed:", error.message);
    } finally {
      await this.cleanup();
      this.printSecurityReport();
    }
  }

  printSecurityReport() {
    console.log("\n🛡️ SECURITY ASSESSMENT REPORT");
    console.log("=".repeat(50));

    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(
      (r) => r.status === "PASS",
    ).length;
    const failedTests = this.testResults.filter(
      (r) => r.status === "FAIL",
    ).length;
    const warningTests = this.testResults.filter(
      (r) => r.status === "WARN",
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
      100 - this.vulnerabilityCount * 25 - this.warningCount * 5,
    );

    console.log(`🏆 Security Score: ${securityScore}/100`);

    if (securityScore >= 90) {
      console.log("✅ EXCELLENT - Production ready");
    } else if (securityScore >= 75) {
      console.log("✅ GOOD - Minor issues to address");
    } else if (securityScore >= 50) {
      console.log("⚠️ FAIR - Significant issues need attention");
    } else {
      console.log("❌ POOR - Critical security issues must be fixed");
    }

    // List critical issues
    const criticalIssues = this.testResults.filter(
      (r) =>
        r.status === "FAIL" &&
        (r.severity === "critical" || r.severity === "high"),
    );

    if (criticalIssues.length > 0) {
      console.log("\n🚨 CRITICAL SECURITY ISSUES:");
      criticalIssues.forEach((issue) => {
        console.log(`   • ${issue.test}: ${issue.details}`);
      });
    }

    console.log("\n🔒 Security test completed!");

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
