const crypto = require("crypto");
const {
  SlimCryptDB,
  generateEncryptionKey,
  createSecureDatabase,
} = require("./SlimCryptDB.js");
const { promises: fs } = require("fs");
const path = require("path");

describe("SlimCryptDB Tests", () => {
  let db;
  let testDir;
  let encryptionKey;
  let tableName;

  beforeAll(async () => {
    testDir = path.join(__dirname, "test-data");
    encryptionKey = generateEncryptionKey();
    db = new SlimCryptDB(testDir, encryptionKey, {
      encrypt: true,
      compression: true,
      walEnabled: true,
      syncWrites: true,
    });
    tableName = "test_table" + crypto.randomBytes(4).toString("hex");
  });

  afterAll(async () => {
    await db.close();
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("Database Initialization", () => {
    test("should initialize database directories", async () => {
      const stats = await fs.stat(testDir);
      expect(stats.isDirectory()).toBeTruthy();
    });

    test("should generate secure encryption keys", () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();

      expect(key1).toHaveLength(32);
      expect(key2).toHaveLength(32);
      expect(key1).not.toEqual(key2);
    });

    test("should create secure database instance", async () => {
      const secureDb = createSecureDatabase("./test-secure");
      await secureDb.ready();
      expect(secureDb).toBeInstanceOf(SlimCryptDB);
      await secureDb.close();
      await fs.rm("./test-secure", { recursive: true });
    });
  });

  describe("Table Management", () => {
    const userSchema = {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        age: { type: "number", minimum: 0 },
      },
      required: ["name", "email"],
    };

    test("should create table with schema", async () => {
      await expect(
        db.createTable(tableName, userSchema),
      ).resolves.toBeUndefined();
    });

    test("should prevent duplicate table creation", async () => {
      await expect(db.createTable(tableName, userSchema)).rejects.toThrow(
        `Table ${tableName} already exists`,
      );
    });

    test("should validate schema on data insertion", async () => {
      const invalidData = { name: "Test User" }; // Missing required email

      await expect(db.addData(tableName, invalidData)).rejects.toThrow(
        "Missing required property: email",
      );
    });
  });

  describe("CRUD Operations", () => {
    test("should add data with automatic ID generation", async () => {
      const userData = {
        name: "Alice Cooper",
        email: "alice@example.com",
        age: 30,
      };

      const result = await db.addData(tableName, userData);

      expect(result).toHaveProperty("id");
      expect(result.name).toBe("Alice Cooper");
      expect(result.email).toBe("alice@example.com");
      expect(result.age).toBe(30);
    });

    test("should read data with filtering", async () => {
      const data = await db.readData(tableName, { name: "Alice Cooper" });

      expect(Array.isArray(data)).toBeTruthy();
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("Alice Cooper");
    });

    test("should perform complex queries", async () => {
      // Add more test data
      await db.addData(tableName, {
        name: "Bob Smith",
        email: "bob@example.com",
        age: 25,
      });
      await db.addData(tableName, {
        name: "Carol Jones",
        email: "carol@example.com",
        age: 35,
      });

      const adults = await db.queryData(tableName, {
        filter: {
          operator: "and",
          conditions: [{ column: "age", operator: ">=", value: 30 }],
        },
        sort: { column: "name", direction: "asc" },
      });

      expect(adults).toHaveLength(2);
      expect(adults[0].name).toBe("Alice Cooper");
      expect(adults[1].name).toBe("Carol Jones");
    });

    test("should handle pagination", async () => {
      const firstPage = await db.queryData(tableName, {
        limit: 2,
        offset: 0,
        sort: { column: "name", direction: "asc" },
      });

      const secondPage = await db.queryData(tableName, {
        limit: 2,
        offset: 2,
        sort: { column: "name", direction: "asc" },
      });

      expect(firstPage).toHaveLength(2);
      expect(secondPage).toHaveLength(1);
      expect(firstPage[0].name).toBe("Alice Cooper");
      expect(secondPage[0].name).toBe("Carol Jones");
    });

    test("should update data", async () => {
      const data = await db.readData(tableName, { name: "Alice Cooper" });
      const updatedData = { ...data[0], age: 31 };

      await db.updateData(tableName, { id: data[0].id }, updatedData);

      const newData = await db.readData(tableName, { name: "Alice Cooper" });
      expect(newData[0].age).toBe(31);
    });

    test("should delete data", async () => {
      const data = await db.readData(tableName, { name: "Alice Cooper" });

      await db.deleteData(tableName, { id: data[0].id });

      const newData = await db.readData(tableName, { name: "Alice Cooper" });
      expect(newData).toHaveLength(0);
    });
  });

  describe("Indexing System", () => {
    test("should create unique index", async () => {
      await expect(
        db.createIndex(tableName, "email_idx", ["email"], { unique: true }),
      ).resolves.toBeUndefined();
    });

    test("should enforce unique constraints", async () => {
      const duplicateEmail = {
        name: "Duplicate User",
        email: "bob@example.com", // Duplicate email
        age: 25,
      };

      await expect(db.addData(tableName, duplicateEmail)).rejects.toThrow(
        "Unique constraint violation",
      );
    });

    test("should create compound index", async () => {
      await expect(
        db.createIndex(tableName, "name_age_idx", ["name", "age"]),
      ).resolves.toBeUndefined();
    });
  });

  describe("Transaction Management", () => {
    test("should support atomic transactions", async () => {
      const txnId = await db.startTransaction();

      expect(typeof txnId).toBe("string");
      expect(txnId).toHaveLength(32);

      // Add data within transaction
      await db.addData(
        tableName,
        {
          name: "Transaction User",
          email: "txn@example.com",
          age: 28,
        },
        txnId,
      );

      await db.commitTransaction(txnId);

      const data = await db.readData(tableName, { name: "Transaction User" });
      expect(data).toHaveLength(1);
    });

    test("should rollback failed transactions", async () => {
      const txnId = await db.startTransaction();

      try {
        await db.addData(
          tableName,
          {
            name: "Rollback User",
            email: "rollback@example.com",
            age: 30,
          },
          txnId,
        );

        // Force an error
        throw new Error("Simulated error");
      } catch (error) {
        await db.rollbackTransaction(txnId);
      }

      const data = await db.readData(tableName, { name: "Rollback User" });
      expect(data).toHaveLength(0);
    });
  });

  describe("Encryption & Security", () => {
    test("should encrypt data at rest", async () => {
      // Check that raw file data is encrypted
      const filePath = path.join(testDir, `${tableName}.db`);
      const rawData = await fs.readFile(filePath, "utf8");

      // Should not contain plaintext data
      expect(rawData).not.toContain("Alice Cooper");
      expect(rawData).not.toContain("alice@example.com");
    });

    test("should use unique IVs for each encryption", async () => {
      const testTable1 = "iv_test_1";
      const testTable2 = "iv_test_2";

      await db.createTable(testTable1);
      await db.createTable(testTable2);

      const rawData1 = await fs.readFile(
        path.join(testDir, `${testTable1}.db`),
        "utf8",
      );
      const rawData2 = await fs.readFile(
        path.join(testDir, `${testTable2}.db`),
        "utf8",
      );

      // Extract IVs (first 32 hex characters)
      const iv1 = rawData1.substring(0, 32);
      const iv2 = rawData2.substring(0, 32);

      expect(iv1).not.toBe(iv2);
    });

    test("should detect data tampering", async () => {
      const filePath = path.join(testDir, `${tableName}.db`);
      let rawData = await fs.readFile(filePath, "utf8");

      // Corrupt the data
      const corruptedData =
        rawData.substring(0, rawData.length - 10) + "corrupted!";
      await fs.writeFile(filePath, corruptedData);

      // Should throw decryption error
      await expect(db.readData(tableName, {})).rejects.toThrow(
        "Decryption failed",
      );
    });
  });

  describe("Event System", () => {
    test("should emit events for data operations", (done) => {
      const eventTableName = "event_test_table";

      db.on("createTable", (tableName, tableData) => {
        expect(tableName).toBe(eventTableName);
        expect(tableData).toHaveProperty("name", eventTableName);
        done();
      });

      db.createTable(eventTableName);
    });

    test("should emit transaction events", (done) => {
      let eventsReceived = 0;
      const expectedEvents = 1;

      db.on("commitTransaction", (transactionId) => {
        expect(typeof transactionId).toBe("string");
        eventsReceived++;

        if (eventsReceived === expectedEvents) {
          done();
        }
      });

      db.startTransaction().then(async (txnId) => {
        await db.commitTransaction(txnId);
      });
    });
  });

  describe("Error Handling", () => {
    test("should handle non-existent table reads", async () => {
      await expect(db.readData("non_existent_table", {})).rejects.toThrow(
        "Table non_existent_table does not exist",
      );
    });

    test("should handle invalid transaction IDs", async () => {
      await expect(db.commitTransaction("invalid_txn_id")).rejects.toThrow(
        "Transaction invalid_txn_id not found",
      );
    });
  });

  describe("Graceful Shutdown", () => {
    test("should close gracefully", async () => {
      await expect(db.close()).resolves.toBeUndefined();
    });
  });
});
