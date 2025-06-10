const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');
const zlib = require('zlib');
const util = require('util');
const path = require('path');

// Promisify compression functions
const gzip = util.promisify(zlib.gzip);
const gunzip = util.promisify(zlib.gunzip);

/**
 * SlimCryptDB - A lightweight, secure, high-performance encrypted database
 * Features: AES-256-GCM encryption, encrypted WAL, indexing, schema validation, compression
 */
class SlimCryptDB {
  constructor(databaseDir, encryptionKey = null, options = {}) {
    this.databaseDir = databaseDir;
    // Create a copy of the encryption key to prevent shared Buffer issues
    this.encryptionKey = encryptionKey
      ? Buffer.from(encryptionKey)
      : this._generateSecureKey();
    this.options = {
      encrypt: true,
      compression: true,
      walEnabled: true,
      syncWrites: true,
      maxWalSize: 100 * 1024 * 1024, // 100MB
      checkpointInterval: 30000, // 30 seconds
      lockTimeout: 10000, // 10 seconds - increased timeout
      walPaddingSize: 1024, // Fixed size for WAL entries to prevent size-based attacks
      ...options,
    };

    this.eventEmitter = new EventEmitter();
    this.indexes = new Map();
    this.locks = new Map();
    this.lockQueue = new Map(); // Queue for waiting transactions
    this.transactions = new Map();
    this.schemas = new Map();
    this.walSequence = 0;
    this.walBuffer = [];
    this.isCheckpointing = false;
    this.checkpointTimer = null; // Store timer reference for cleanup
    this.isClosed = false;

    // WAL encryption properties
    this.walSalt = null;
    this.walKey = null;
    this.walEncrypted = false;

    // Track initialization state
    this.initializationPromise = null;
    this.isInitialized = false;

    // Start initialization immediately
    this.initializationPromise = this._initializeDatabase();
  }

  // ensure initialization is complete
  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }
  }

  // check if database is ready
  async ready() {
    await this.ensureInitialized();
    return this.isInitialized;
  }

  /**
   * Initialize database directory and WAL
   */
  async _initializeDatabase() {
    try {
      await fs.mkdir(this.databaseDir, { recursive: true });
      await fs.mkdir(path.join(this.databaseDir, 'wal'), { recursive: true });
      await fs.mkdir(path.join(this.databaseDir, 'indexes'), {
        recursive: true,
      });

      // initialize WAL encryption before WAL recovery
      await this._initializeWALEncryption();

      if (this.options.walEnabled) {
        await this._recoverFromWAL();
      }

      // Mark as initialized only after everything is complete
      this.isInitialized = true;
      this._startCheckpointScheduler();
    } catch (error) {
      throw new Error(`Database initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize WAL encryption salt and key with proper error handling
   */
  async _initializeWALEncryption() {
    const saltPath = path.join(this.databaseDir, 'wal', '.salt');

    try {
      // Try to load existing salt
      const existingSalt = await fs.readFile(saltPath);
      this.walSalt = existingSalt;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Generate new salt if it doesn't exist
        this.walSalt = crypto.randomBytes(32);
        // Save salt for future use (only if encryption is enabled)
        if (this.options.encrypt) {
          await fs.writeFile(saltPath, this.walSalt);
        }
      } else {
        throw error;
      }
    }

    // Derive WAL key from main encryption key and persistent salt
    if (this.options.encrypt && this.encryptionKey && this.options.walEnabled) {
      this.walKey = this._deriveWALKey(); // Always derive fresh key
      this.walEncrypted = true;
    } else {
      this.walEncrypted = false;
    }

    // Validate that encryption is properly set up
    if (this.options.encrypt && this.options.walEnabled && !this.walEncrypted) {
      throw new Error('WAL encryption failed to initialize properly');
    }
  }

  /**
   * Generate cryptographically secure encryption key
   */
  _generateSecureKey() {
    return crypto.randomBytes(32); // 256-bit key for AES-256-GCM
  }

  /**
   * Derive WAL-specific encryption key with enhanced validation
   */
  _deriveWALKey() {
    if (!this.walSalt) {
      throw new Error('WAL salt not initialized');
    }
    if (!this.encryptionKey) {
      throw new Error('Encryption key not provided');
    }

    // Validate encryption key hasn't been wiped
    const keySum = this.encryptionKey.reduce((sum, byte) => sum + byte, 0);
    if (keySum === 0) {
      throw new Error('Encryption key has been wiped - cannot derive WAL key');
    }

    try {
      // Use synchronous PBKDF2 to avoid timing issues
      return crypto.pbkdf2Sync(
        this.encryptionKey,
        this.walSalt,
        100000, // Strong iteration count
        32, // 256-bit key
        'sha256'
      );
    } catch (error) {
      throw new Error(`WAL key derivation failed: ${error.message}`);
    }
  }

  /**
   * Encrypt data using AES-256-GCM with authenticated encryption and strict validation
   */
  _encryptData(data) {
    if (!this.options.encrypt) {
      return JSON.stringify(data);
    }

    try {
      const plaintext = JSON.stringify(data);
      const iv = crypto.randomBytes(16); // Unique IV for each encryption
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        iv
      );

      let ciphertext = cipher.update(plaintext, 'utf8');
      ciphertext = Buffer.concat([ciphertext, cipher.final()]);

      const authTag = cipher.getAuthTag();

      // Validate auth tag length for consistency
      if (authTag.length !== 16) {
        throw new Error(`Invalid authentication tag length: ${authTag.length}`);
      }

      // Format: iv:authTag:ciphertext (all hex encoded)
      return (
        iv.toString('hex') +
        ':' +
        authTag.toString('hex') +
        ':' +
        ciphertext.toString('hex')
      );
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data using AES-256-GCM with strict authentication verification
   */
  _decryptData(encryptedData) {
    if (!this.options.encrypt) {
      try {
        return JSON.parse(encryptedData);
      } catch {
        throw new Error('Invalid unencrypted data format');
      }
    }

    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const ciphertext = Buffer.from(parts[2], 'hex');

      // Strict validation of component sizes
      if (iv.length !== 16) {
        throw new Error(`Invalid IV length: expected 16, got ${iv.length}`);
      }
      if (authTag.length !== 16) {
        throw new Error(
          `Invalid authentication tag length: expected 16, got ${authTag.length}`
        );
      }
      if (ciphertext.length === 0) {
        throw new Error('Empty ciphertext');
      }

      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        iv
      );
      decipher.setAuthTag(authTag);

      let plaintext;
      try {
        plaintext = decipher.update(ciphertext);
        plaintext = Buffer.concat([plaintext, decipher.final()]);
      } catch (error) {
        // Enhanced authentication failure detection
        if (
          error.message.includes(
            'Unsupported state or unable to authenticate data'
          ) ||
          error.message.includes('authentication') ||
          error.message.includes('auth') ||
          error.code === 'ERR_CRYPTO_AUTH_FAILED'
        ) {
          throw new Error(`Authentication failed: data has been tampered with`);
        }
        throw new Error(`Decryption failed: ${error.message}`);
      }

      // Validate plaintext is valid JSON
      const plaintextStr = plaintext.toString('utf8');
      try {
        return JSON.parse(plaintextStr);
      } catch (jsonError) {
        throw new Error(
          `Authentication failed: decrypted data is not valid JSON`
        );
      }
    } catch (error) {
      // Ensure authentication failures are properly categorized
      if (error.message.includes('Authentication failed')) {
        throw error;
      }
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Encrypt WAL data with consistent key handling
   */
  _encryptWALData(data) {
    if (!this.options.walEnabled || !this.options.encrypt) {
      return JSON.stringify(data);
    }

    if (!this.walEncrypted || !this.walKey || !this.walSalt) {
      throw new Error(
        'WAL encryption not properly initialized - cannot write unencrypted data'
      );
    }

    try {
      // Convert data object to JSON string
      const plaintext = JSON.stringify(data);

      // Use the cached WAL key (don't re-derive during encryption)
      const walKey = this.walKey;
      if (!walKey) {
        throw new Error('WAL key not available during encryption');
      }

      // Create unique IV for this encryption
      const iv = crypto.randomBytes(16);

      // Convert JSON string to Buffer and apply padding
      const plaintextBuffer = Buffer.from(plaintext, 'utf8');
      const paddedBuffer = this._applyWALPaddingBuffer(plaintextBuffer);

      // Create cipher with GCM mode
      const cipher = crypto.createCipheriv('aes-256-gcm', walKey, iv);

      // Encrypt the padded buffer
      let ciphertext = cipher.update(paddedBuffer);
      ciphertext = Buffer.concat([ciphertext, cipher.final()]);

      // Get authentication tag
      const authTag = cipher.getAuthTag();

      // Format: WAL:iv:authTag:ciphertext (all hex encoded with WAL prefix)
      return (
        'WAL:' +
        iv.toString('hex') +
        ':' +
        authTag.toString('hex') +
        ':' +
        ciphertext.toString('hex')
      );
    } catch (error) {
      throw new Error(`WAL encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt WAL data with consistent key handling
   */
  _decryptWALData(encryptedData) {
    if (!this.options.encrypt) {
      try {
        return JSON.parse(encryptedData);
      } catch {
        throw new Error('Invalid unencrypted WAL data format');
      }
    }

    try {
      // Check for WAL prefix
      if (!encryptedData.startsWith('WAL:')) {
        // Handle legacy unencrypted WAL files
        try {
          return JSON.parse(encryptedData);
        } catch {
          throw new Error('Invalid WAL data format');
        }
      }

      if (!this.walEncrypted || !this.walKey) {
        throw new Error('Cannot decrypt WAL data: encryption not initialized');
      }

      // Parse WAL format
      const walData = encryptedData.substring(4); // Remove 'WAL:' prefix
      const parts = walData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted WAL data format');
      }

      // Extract components
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const ciphertext = Buffer.from(parts[2], 'hex');

      // Use the cached WAL key (don't re-derive during decryption)
      const walKey = this.walKey;
      if (!walKey) {
        throw new Error('WAL key not available during decryption');
      }

      // Create decipher
      const decipher = crypto.createDecipheriv('aes-256-gcm', walKey, iv);
      decipher.setAuthTag(authTag);

      // Decrypt to get padded buffer
      let paddedBuffer = decipher.update(ciphertext);
      paddedBuffer = Buffer.concat([paddedBuffer, decipher.final()]);

      // Remove padding
      const plaintextBuffer = this._removeWALPaddingBuffer(paddedBuffer);

      // Convert buffer back to string and parse JSON
      const plaintext = plaintextBuffer.toString('utf8');
      return JSON.parse(plaintext);
    } catch (error) {
      throw new Error(`WAL decryption failed: ${error.message}`);
    }
  }

  /**
   * Apply length-prefixed padding with fixed size to prevent size-based attacks
   * This replaces the broken PKCS#7 implementation for large block sizes
   */
  _applyWALPaddingBuffer(plaintextBuffer) {
    const blockSize = this.options.walPaddingSize;
    const textLength = plaintextBuffer.length;

    let paddedSize;
    if (textLength >= blockSize - 4) {
      // Reserve 4 bytes for length encoding
      // For large entries, use multiple blocks
      const blocksNeeded = Math.ceil((textLength + 4) / blockSize);
      paddedSize = blocksNeeded * blockSize;
    } else {
      // For small entries, pad to fixed block size
      paddedSize = blockSize;
    }

    const paddingLength = paddedSize - textLength - 4; // Reserve 4 bytes for length

    // Create padding filled with random bytes for security
    const padding = crypto.randomBytes(paddingLength);

    // Create length buffer (4 bytes, big-endian)
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(textLength, 0);

    return Buffer.concat([plaintextBuffer, padding, lengthBuffer]);
  }

  /**
   * Remove length-prefixed padding
   */
  _removeWALPaddingBuffer(paddedBuffer) {
    if (paddedBuffer.length < 4) {
      throw new Error('Invalid padded buffer: too short');
    }

    // Read original length from last 4 bytes (big-endian)
    const originalLength = paddedBuffer.readUInt32BE(paddedBuffer.length - 4);

    // Validate length
    if (originalLength < 0 || originalLength > paddedBuffer.length - 4) {
      throw new Error(`Invalid original length: ${originalLength}`);
    }

    return paddedBuffer.slice(0, originalLength);
  }

  /**
   * Compress data using gzip (applied AFTER encryption)
   */
  async _compressData(data) {
    if (!this.options.compression) return data;

    try {
      if (typeof data === 'string') {
        return await gzip(Buffer.from(data, 'utf8'));
      } else if (Buffer.isBuffer(data)) {
        return await gzip(data);
      }
      return data;
    } catch (error) {
      // If compression fails, return original data
      console.warn(
        'Compression failed, using uncompressed data:',
        error.message
      );
      return data;
    }
  }

  /**
   * Decompress data using gunzip (applied BEFORE decryption)
   */
  async _decompressData(compressedData) {
    if (!this.options.compression) return compressedData;

    try {
      if (Buffer.isBuffer(compressedData)) {
        const decompressed = await gunzip(compressedData);
        return decompressed.toString('utf8');
      }
      return compressedData;
    } catch (error) {
      // If decompression fails, assume data is not compressed
      if (Buffer.isBuffer(compressedData)) {
        return compressedData.toString('utf8');
      }
      return compressedData;
    }
  }

  /**
   * Write-Ahead Logging implementation
   */
  async _writeWAL(operation) {
    if (!this.options.walEnabled || this.isClosed) return;

    // Always ensure initialization is complete before WAL operations
    await this.ensureInitialized();

    const walEntry = {
      sequence: ++this.walSequence,
      timestamp: Date.now(),
      operation,
      checksum: this._calculateChecksum(operation),
    };

    this.walBuffer.push(walEntry);

    if (this.options.syncWrites) {
      await this._flushWAL();
    }

    // Trigger checkpoint if WAL size exceeds limit
    if (this.walBuffer.length * 1000 > this.options.maxWalSize) {
      setImmediate(() => this._checkpoint());
    }
  }

  /**
   * Flush WAL buffer to disk
   */
  async _flushWAL() {
    if (this.walBuffer.length === 0 || this.isClosed) return;

    const walFile = path.join(this.databaseDir, 'wal', `wal-${Date.now()}.log`);

    // Encrypt each WAL entry individually to maintain entry boundaries
    const encryptedEntries = this.walBuffer.map((entry) => {
      const encryptedEntry = this._encryptWALData(entry);
      return encryptedEntry;
    });

    const walData = encryptedEntries.join('\n') + '\n';

    // Initialize the file directory if it doesn't exist
    try {
      await fs.mkdir(path.dirname(walFile), { recursive: true });
    } catch (error) {
      // Directory already exists
    }

    await fs.writeFile(walFile, walData, { flag: 'a' });
    this.walBuffer = [];
  }

  /**
   * Recover from WAL files
   */
  async _recoverFromWAL() {
    // Ensure encryption is initialized before recovery
    if (this.options.encrypt && this.options.walEnabled) {
      if (!this.walEncrypted || !this.walKey) {
        throw new Error('WAL encryption not properly initialized for recovery');
      }
    }

    const walDir = path.join(this.databaseDir, 'wal');
    const recoveryFailures = [];
    let recoveredEntries = 0;

    // Check if WAL directory exists
    try {
      await fs.access(walDir);
    } catch (error) {
      // WAL directory doesn't exist, nothing to recover
      return;
    }

    const walFiles = await fs.readdir(walDir);
    const logFiles = walFiles.filter((file) => file.endsWith('.log')).sort();

    for (const walFile of logFiles) {
      if (walFile === '.salt') continue;

      const walPath = path.join(walDir, walFile);

      try {
        const walContent = await fs.readFile(walPath, 'utf8');
        const walEntries = walContent.trim().split('\n').filter(Boolean);

        for (const entryLine of walEntries) {
          try {
            // Decrypt WAL entry
            const walEntry = this._decryptWALData(entryLine);
            await this._applyWALEntry(walEntry);
            recoveredEntries++;
          } catch (error) {
            // Log and track failed WAL entry
            console.warn(
              `[WAL RECOVERY] Failed to process entry in ${walFile}: ${error.message}`
            );
            recoveryFailures.push({
              file: walFile,
              entry:
                entryLine.slice(0, 80) + (entryLine.length > 80 ? '...' : ''),
              error: error.message,
            });
          }
        }
      } catch (error) {
        console.warn(
          `[WAL RECOVERY] Failed to process WAL file ${walFile}: ${error.message}`
        );
        recoveryFailures.push({
          file: walFile,
          entry: null,
          error: error.message,
        });
      }
    }

    // Summary report for audit and testing
    if (recoveryFailures.length > 0) {
      console.warn(
        `[WAL RECOVERY] Completed with ${recoveryFailures.length} failures and ${recoveredEntries} successful entries.`
      );
      this.lastWALRecoveryFailures = recoveryFailures;
    } else {
      this.lastWALRecoveryFailures = [];
    }
  }

  getWALRecoverySummary() {
    return {
      failures: this.lastWALRecoveryFailures || [],
      successCount:
        typeof this.lastWALRecoveryFailures === 'undefined'
          ? null
          : this.lastWALRecoveryFailures.length || 0,
    };
  }

  /**
   * Apply WAL entry during recovery
   */
  async _applyWALEntry(walEntry) {
    const { operation } = walEntry;

    // Verify checksum
    if (this._calculateChecksum(operation) !== walEntry.checksum) {
      throw new Error('WAL entry checksum mismatch');
    }

    // Apply operation based on type
    switch (operation.type) {
      case 'write':
        await this._writeDataDirect(operation.tableName, operation.data);
        break;
      case 'create_table':
        await this._createTableDirect(operation.tableName, operation.schema);
        break;
      case 'delete_table':
        await this._deleteTableDirect(operation.tableName);
        break;
    }
  }

  /**
   * Calculate checksum for data integrity
   */
  _calculateChecksum(data) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  /**
   * Checkpoint: Apply WAL entries and clean up
   */
  async _checkpoint() {
    if (this.isCheckpointing || this.isClosed) return;
    this.isCheckpointing = true;

    try {
      await this._flushWAL();

      // Clean up old WAL files
      const walDir = path.join(this.databaseDir, 'wal');
      const walFiles = await fs.readdir(walDir);
      const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

      for (const walFile of walFiles) {
        if (walFile === '.salt') continue;

        const filePath = path.join(walDir, walFile);

        try {
          const stats = await fs.stat(filePath);
          if (stats.mtime.getTime() < cutoffTime) {
            await fs.unlink(filePath);
          }
        } catch (error) {
          // File might have been deleted already
        }
      }
    } finally {
      this.isCheckpointing = false;
    }
  }

  /**
   * Start automatic checkpoint scheduler
   */
  _startCheckpointScheduler() {
    if (this.isClosed) return;

    this.checkpointTimer = setInterval(() => {
      if (!this.isClosed) {
        this._checkpoint().catch(console.error);
      }
    }, this.options.checkpointInterval);
  }

  /**
   * Schema validation using JSON Schema
   */
  _validateSchema(tableName, data) {
    const schema = this.schemas.get(tableName);
    if (!schema) return true;

    return this._validateDataAgainstSchema(data, schema);
  }

  /**
   * Basic JSON schema validation
   */
  _validateDataAgainstSchema(data, schema) {
    if (schema.type === 'array' && Array.isArray(data)) {
      // set array type as an object if schema type is array
      schema.type = 'object';
    }
    if (schema.type && typeof data !== schema.type) {
      throw new Error(
        `Type mismatch: expected ${schema.type}, got ${typeof data}: ${JSON.stringify(data)}`
      );
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (
          schema.required &&
          schema.required.includes(key) &&
          !(key in data)
        ) {
          throw new Error(`Missing required property: ${key}`);
        }
        if (key in data) {
          this._validateDataAgainstSchema(data[key], propSchema);
        }
      }
    }

    return true;
  }

  /**
   * Create table with optional schema
   */
  async createTable(tableName, schema = null) {
    if (this.tableExists(tableName)) {
      throw new Error(`Table ${tableName} already exists`);
    }

    const tableData = {
      name: tableName,
      schema,
      rows: [],
      created: Date.now(),
      version: 1,
    };

    if (schema) {
      this.schemas.set(tableName, schema);
    }

    await this._writeWAL({
      type: 'create_table',
      tableName,
      schema,
    });

    await this._createTableDirect(tableName, tableData);

    this.eventEmitter.emit('createTable', tableName, tableData);

    // Create default index on 'id' field if schema specifies it
    if (schema && schema.properties && schema.properties.id) {
      await this.createIndex(tableName, 'id_idx', ['id']);
    }
  }

  async _createTableDirect(tableName, tableData) {
    const filePath = path.join(this.databaseDir, `${tableName}.db`);

    // Encrypt first, then compress
    let data = this._encryptData(tableData);

    if (this.options.compression) {
      data = await this._compressData(data);
    }

    await fs.writeFile(filePath, data);
  }

  /**
   * Delete a table and all its data
   */
  async deleteTable(tableName) {
    if (!this.tableExists(tableName)) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    await this._writeWAL({
      type: 'delete_table',
      tableName,
    });

    await this._deleteTableDirect(tableName);

    // Remove from schemas
    this.schemas.delete(tableName);

    // Remove related indexes
    for (const [indexName, index] of this.indexes) {
      if (index.tableName === tableName) {
        this.indexes.delete(indexName);
      }
    }

    this.eventEmitter.emit('deleteTable', tableName);
  }

  async _deleteTableDirect(tableName) {
    const filePath = path.join(this.databaseDir, `${tableName}.db`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Enhanced indexing system
   */
  async createIndex(tableName, indexName, columns, options = {}) {
    const indexType = options.type || 'btree'; // btree or hash
    const isUnique = options.unique || false;

    const data = await this.readData(tableName, {});
    const index = new Map();

    for (const item of data) {
      const indexKey = this._buildIndexKey(item, columns);

      if (isUnique && index.has(indexKey)) {
        throw new Error(
          `Duplicate key violation for unique index: ${indexKey}`
        );
      }

      if (!index.has(indexKey)) {
        index.set(indexKey, []);
      }
      index.get(indexKey).push(item.id || item);
    }

    this.indexes.set(indexName, {
      tableName,
      columns,
      type: indexType,
      unique: isUnique,
      data: index,
    });

    // Persist index to disk
    await this._saveIndex(indexName);

    this.eventEmitter.emit('createIndex', tableName, indexName);
  }

  /**
   * Drop an index
   */
  async dropIndex(indexName) {
    if (!this.indexes.has(indexName)) {
      throw new Error(`Index ${indexName} does not exist`);
    }

    this.indexes.delete(indexName);

    // Remove index file
    const indexPath = path.join(
      this.databaseDir,
      'indexes',
      `${indexName}.idx`
    );
    try {
      await fs.unlink(indexPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  _buildIndexKey(item, columns) {
    return columns.map((col) => item[col]).join('::');
  }

  async _saveIndex(indexName) {
    const index = this.indexes.get(indexName);
    if (!index) return;

    const indexPath = path.join(
      this.databaseDir,
      'indexes',
      `${indexName}.idx`
    );
    const indexData = {
      ...index,
      data: Array.from(index.data.entries()),
    };

    // Encrypt first, then compress
    let data = this._encryptData(indexData);
    if (this.options.compression) {
      data = await this._compressData(data);
    }

    await fs.writeFile(indexPath, data);
  }

  /**
   * Enhanced transaction support with isolation
   */
  async startTransaction(isolationLevel = 'READ_COMMITTED') {
    const transactionId = crypto.randomBytes(16).toString('hex');

    this.transactions.set(transactionId, {
      id: transactionId,
      operations: [],
      isolationLevel,
      startTime: Date.now(),
      locks: new Set(),
      snapshot: new Map(), // For REPEATABLE_READ isolation
    });

    return transactionId;
  }

  async commitTransaction(transactionId) {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    try {
      // Apply all operations atomically
      for (const operation of transaction.operations) {
        await this._applyOperation(operation);
      }

      // Release locks
      for (const tableName of transaction.locks) {
        this._releaseLock(tableName, transactionId);
      }

      this.transactions.delete(transactionId);
      this.eventEmitter.emit('commitTransaction', transactionId);
    } catch (error) {
      await this.rollbackTransaction(transactionId);
      throw error;
    }
  }

  async rollbackTransaction(transactionId) {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return;

    // Release locks
    for (const tableName of transaction.locks) {
      this._releaseLock(tableName, transactionId);
    }

    this.transactions.delete(transactionId);
    this.eventEmitter.emit('rollbackTransaction', transactionId);
  }

  /**
   * Enhanced CRUD operations with validation and indexing
   */
  async addData(tableName, data, transactionId = null) {
    await this.ensureInitialized(); // Ensure initialization before any data operations

    if (!transactionId) {
      transactionId = await this.startTransaction();

      try {
        const result = await this.addData(tableName, data, transactionId);
        await this.commitTransaction(transactionId);
        return result;
      } catch (error) {
        await this.rollbackTransaction(transactionId);
        throw error;
      }
    }

    // Schema validation
    this._validateSchema(tableName, data);

    // Generate ID if not present
    if (!data.id) {
      data.id = crypto.randomBytes(16).toString('hex');
    }

    const transaction = this.transactions.get(transactionId);
    await this._acquireLock(tableName, transactionId);

    transaction.operations.push({
      type: 'add',
      tableName,
      data: { ...data },
    });

    // Update indexes
    await this._updateIndexesForAdd(tableName, data);

    this.eventEmitter.emit('add', tableName, data);
    return data;
  }

  /**
   * Update data in a table with schema validation
   */
  async updateData(tableName, filter, updateData, transactionId = null) {
    await this.ensureInitialized(); // Ensure initialization before any data operations

    if (!transactionId) {
      transactionId = await this.startTransaction();

      try {
        const result = await this.updateData(
          tableName,
          filter,
          updateData,
          transactionId
        );
        await this.commitTransaction(transactionId);
        return result;
      } catch (error) {
        await this.rollbackTransaction(transactionId);
        throw error;
      }
    }

    // Schema validation for update data
    if (this.schemas.has(tableName)) {
      this._validateSchema(tableName, updateData);
    }

    const transaction = this.transactions.get(transactionId);
    await this._acquireLock(tableName, transactionId);

    // Read existing data
    const existingData = await this.readData(tableName, {});
    const recordsToUpdate = existingData.filter((item) => {
      return Object.entries(filter).every(([key, value]) => {
        if (value instanceof RegExp) {
          return value.test(item[key]);
        }
        return item[key] === value;
      });
    });

    // Update each matching record
    for (const record of recordsToUpdate) {
      const updatedRecord = { ...record, ...updateData };

      // Ensure ID is preserved
      if (record.id) {
        updatedRecord.id = record.id;
      }

      transaction.operations.push({
        type: 'update',
        tableName,
        oldData: { ...record },
        newData: updatedRecord,
        id: record.id,
      });

      // Update indexes
      await this._updateIndexesForUpdate(tableName, record, updatedRecord);
    }

    this.eventEmitter.emit('update', tableName, recordsToUpdate, updateData);
    return recordsToUpdate.length;
  }

  /**
   * Delete data from a table
   */
  async deleteData(tableName, filter, transactionId = null) {
    await this.ensureInitialized(); // Ensure initialization before any data operations

    if (!transactionId) {
      transactionId = await this.startTransaction();

      try {
        const result = await this.deleteData(tableName, filter, transactionId);
        await this.commitTransaction(transactionId);
        return result;
      } catch (error) {
        await this.rollbackTransaction(transactionId);
        throw error;
      }
    }

    const transaction = this.transactions.get(transactionId);
    await this._acquireLock(tableName, transactionId);

    // Read existing data
    const existingData = await this.readData(tableName, {});
    const recordsToDelete = existingData.filter((item) => {
      return Object.entries(filter).every(([key, value]) => {
        if (value instanceof RegExp) {
          return value.test(item[key]);
        }
        return item[key] === value;
      });
    });

    // Add delete operation for each record
    for (const record of recordsToDelete) {
      transaction.operations.push({
        type: 'delete',
        tableName,
        data: { ...record },
        id: record.id,
      });

      // Update indexes
      await this._updateIndexesForDelete(tableName, record);
    }

    this.eventEmitter.emit('delete', tableName, recordsToDelete);
    return recordsToDelete.length;
  }

  async _updateIndexesForAdd(tableName, data) {
    for (const [indexName, index] of this.indexes) {
      if (index.tableName === tableName) {
        const indexKey = this._buildIndexKey(data, index.columns);

        if (index.unique && index.data.has(indexKey)) {
          throw new Error(`Unique constraint violation for index ${indexName}`);
        }

        if (!index.data.has(indexKey)) {
          index.data.set(indexKey, []);
        }
        index.data.get(indexKey).push(data.id);
      }
    }
  }

  /**
   * Update indexes when a record is updated
   */
  async _updateIndexesForUpdate(tableName, oldData, newData) {
    for (const [indexName, index] of this.indexes) {
      if (index.tableName === tableName) {
        const oldKey = this._buildIndexKey(oldData, index.columns);
        const newKey = this._buildIndexKey(newData, index.columns);

        // If the index key has changed
        if (oldKey !== newKey) {
          // Check if the new key violates unique constraint
          if (
            index.unique &&
            index.data.has(newKey) &&
            !index.data.get(newKey).includes(oldData.id)
          ) {
            throw new Error(
              `Unique constraint violation for index ${indexName}`
            );
          }

          // Remove from old key
          if (index.data.has(oldKey)) {
            const ids = index.data.get(oldKey);
            const idIndex = ids.indexOf(oldData.id);
            if (idIndex !== -1) {
              ids.splice(idIndex, 1);

              // Clean up empty arrays
              if (ids.length === 0) {
                index.data.delete(oldKey);
              }
            }
          }

          // Add to new key
          if (!index.data.has(newKey)) {
            index.data.set(newKey, []);
          }
          index.data.get(newKey).push(newData.id);
        }
      }
    }
  }

  /**
   * Update indexes when a record is deleted
   */
  async _updateIndexesForDelete(tableName, data) {
    // eslint-disable-next-line no-unused-vars
    for (const [indexName, index] of this.indexes) {
      if (index.tableName === tableName) {
        const key = this._buildIndexKey(data, index.columns);

        // Remove from index
        if (index.data.has(key)) {
          const ids = index.data.get(key);
          const idIndex = ids.indexOf(data.id);
          if (idIndex !== -1) {
            ids.splice(idIndex, 1);

            // Clean up empty arrays
            if (ids.length === 0) {
              index.data.delete(key);
            }
          }
        }
      }
    }
  }

  /**
   * Enhanced query system with index utilization
   */
  async queryData(tableName, query = {}) {
    const { filter, sort, limit, offset, join } = query;

    // Try to use indexes for filtering
    let data = await this._getDataWithIndex(tableName, filter);

    if (!data) {
      // Fall back to full table scan
      data = await this.readData(tableName, {});
    }

    // Apply additional filters
    if (filter) {
      data = this._applyFilter(data, filter);
    }

    // Apply joins
    if (join) {
      data = await this._applyJoin(data, join);
    }

    // Apply sorting
    if (sort) {
      data = this._applySort(data, sort);
    }

    // Apply pagination
    if (limit || offset) {
      const start = offset || 0;
      const end = limit ? start + limit : undefined;
      data = data.slice(start, end);
    }

    return data;
  }

  tableExists(tableName) {
    const filePath = path.join(this.databaseDir, `${tableName}.db`);
    return fsSync.existsSync(filePath);
  }

  async _getDataWithIndex(tableName, filter) {
    if (!filter || !filter.conditions) return null;

    // eslint-disable-next-line no-unused-vars
    for (const [indexName, index] of this.indexes) {
      if (index.tableName === tableName) {
        const condition = filter.conditions.find(
          (c) => index.columns.includes(c.column) && c.operator === '=='
        );

        if (condition) {
          const indexKey = condition.value;
          const ids = index.data.get(indexKey) || [];

          // Fetch full records
          const allData = await this.readData(tableName, {});
          return allData.filter((item) => ids.includes(item.id));
        }
      }
    }

    return null;
  }

  _applyFilter(data, filter) {
    const { operator, conditions } = filter;

    return data.filter((item) => {
      if (operator === 'and') {
        return conditions.every((condition) =>
          this._evaluateCondition(item, condition)
        );
      } else if (operator === 'or') {
        return conditions.some((condition) =>
          this._evaluateCondition(item, condition)
        );
      }
      return true;
    });
  }

  _evaluateCondition(item, condition) {
    const { column, operator, value } = condition;
    const itemValue = item[column];

    switch (operator) {
      case '==':
        return itemValue === value;
      case '!=':
        return itemValue !== value;
      case '>':
        return itemValue > value;
      case '>=':
        return itemValue >= value;
      case '<':
        return itemValue < value;
      case '<=':
        return itemValue <= value;
      case 'in':
        return Array.isArray(value) && value.includes(itemValue);
      case 'like':
        return new RegExp(value, 'i').test(itemValue);
      case 'contains':
        return new RegExp(value).test(itemValue);
      default:
        return false;
    }
  }

  _applySort(data, sort) {
    const { column, direction = 'asc' } = sort;

    return [...data].sort((a, b) => {
      const aVal = a[column];
      const bVal = b[column];

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /**
   * Read data with caching and optimization
   */
  async readData(tableName, query = {}) {
    const filePath = path.join(this.databaseDir, `${tableName}.db`);

    try {
      let data = await fs.readFile(filePath);

      // Decompress first, then decrypt
      if (this.options.compression) {
        data = await this._decompressData(data);
      }

      const tableData = this._decryptData(data);

      const rows = tableData.rows || [];
      return rows.filter((item) => {
        if (!Object.keys(query).length) return true;

        return Object.entries(query).every(([key, value]) => {
          if (value instanceof RegExp) {
            return value.test(item[key]);
          }
          return item[key] === value;
        });
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Table ${tableName} does not exist`);
      }
      throw error;
    }
  }

  /**
   * Write data directly to table file
   */
  async _writeDataDirect(tableName, rows) {
    const filePath = path.join(this.databaseDir, `${tableName}.db`);
    const tableData = {
      name: tableName,
      rows,
      lastModified: Date.now(),
    };

    // Encrypt first, then compress
    let data = this._encryptData(tableData);
    if (this.options.compression) {
      data = await this._compressData(data);
    }

    await fs.writeFile(filePath, data);
  }

  /**
   * Enhanced lock management with queue support
   */
  async _acquireLock(tableName, transactionId, timeout = null) {
    const lockTimeout = timeout || this.options.lockTimeout;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const attemptLock = () => {
        const currentLock = this.locks.get(tableName);

        if (!currentLock || currentLock === transactionId) {
          this.locks.set(tableName, transactionId);
          const transaction = this.transactions.get(transactionId);
          if (transaction) {
            transaction.locks.add(tableName);
          }
          resolve();
          return;
        }

        if (Date.now() - startTime >= lockTimeout) {
          reject(new Error(`Lock timeout for table ${tableName}`));
          return;
        }

        // Add to wait queue
        if (!this.lockQueue.has(tableName)) {
          this.lockQueue.set(tableName, []);
        }
        this.lockQueue.get(tableName).push({
          transactionId,
          resolve,
          reject,
          startTime,
          timeout: lockTimeout,
        });
      };

      attemptLock();
    });
  }

  /**
   * Release lock and process queue
   */
  _releaseLock(tableName, transactionId) {
    const currentLock = this.locks.get(tableName);
    if (currentLock === transactionId) {
      this.locks.delete(tableName);

      // Process waiting queue
      const queue = this.lockQueue.get(tableName);
      if (queue && queue.length > 0) {
        const nextWaiter = queue.shift();
        const now = Date.now();

        if (now - nextWaiter.startTime < nextWaiter.timeout) {
          this.locks.set(tableName, nextWaiter.transactionId);
          const transaction = this.transactions.get(nextWaiter.transactionId);
          if (transaction) {
            transaction.locks.add(tableName);
          }
          nextWaiter.resolve();
        } else {
          nextWaiter.reject(new Error(`Lock timeout for table ${tableName}`));
        }

        if (queue.length === 0) {
          this.lockQueue.delete(tableName);
        }
      }
    }
  }

  /**
   * Apply operation during transaction commit
   */
  async _applyOperation(operation) {
    switch (operation.type) {
      case 'add':
        await this._applyAddOperation(operation);
        break;
      case 'update':
        await this._applyUpdateOperation(operation);
        break;
      case 'delete':
        await this._applyDeleteOperation(operation);
        break;
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }

    // Clear operation data
    if (operation.data && Buffer.isBuffer(operation.data)) {
      operation.data.fill(0);
    }
  }

  async _applyAddOperation(operation) {
    const { tableName, data } = operation;
    const existingData = await this.readData(tableName, {});

    // Check for duplicate ID
    if (existingData.some((item) => item.id === data.id)) {
      throw new Error(`Duplicate ID: ${data.id}`);
    }

    existingData.push(data);

    await this._writeWAL({
      type: 'write',
      tableName,
      data: existingData,
    });

    await this._writeDataDirect(tableName, existingData);
  }

  /**
   * Apply update operation during transaction commit
   */
  async _applyUpdateOperation(operation) {
    // eslint-disable-next-line no-unused-vars
    const { tableName, oldData, newData, id } = operation;
    const existingData = await this.readData(tableName, {});

    const index = existingData.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error(`Record with ID ${id} not found`);
    }

    // Update the record
    existingData[index] = newData;

    await this._writeWAL({
      type: 'write',
      tableName,
      data: existingData,
    });

    await this._writeDataDirect(tableName, existingData);
  }

  /**
   * Apply delete operation during transaction commit
   */
  async _applyDeleteOperation(operation) {
    // eslint-disable-next-line no-unused-vars
    const { tableName, data, id } = operation;
    const existingData = await this.readData(tableName, {});

    const index = existingData.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error(`Record with ID ${id} not found`);
    }

    // Remove the record
    existingData.splice(index, 1);

    await this._writeWAL({
      type: 'write',
      tableName,
      data: existingData,
    });

    await this._writeDataDirect(tableName, existingData);
  }

  /**
   * Performance monitoring and statistics
   */
  async getStats() {
    return {
      tables: await this._getTableCount(),
      indexes: this.indexes.size,
      activeTransactions: this.transactions.size,
      walSequence: this.walSequence,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      locks: this.locks.size,
      lockQueue: Array.from(this.lockQueue.values()).reduce(
        (sum, queue) => sum + queue.length,
        0
      ),
    };
  }

  async _getTableCount() {
    try {
      const files = await fs.readdir(this.databaseDir);
      return files.filter((file) => file.endsWith('.db')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Enhanced graceful shutdown with proper key management
   */
  async close() {
    if (this.isClosed) return;

    this.isClosed = true;

    // Clear checkpoint timer
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }

    // Flush any remaining WAL entries
    await this._flushWAL();

    // Final checkpoint
    await this._checkpoint();

    // Clear all pending operations
    this.lockQueue.clear();
    this.locks.clear();
    this.transactions.clear();

    // Securely wipe encryption keys (now safe since each instance has its own copy)
    if (this.encryptionKey && Buffer.isBuffer(this.encryptionKey)) {
      this.encryptionKey.fill(0);
    }
    if (this.walKey && Buffer.isBuffer(this.walKey)) {
      this.walKey.fill(0);
    }
    if (this.walSalt && Buffer.isBuffer(this.walSalt)) {
      this.walSalt.fill(0);
    }

    this.encryptionKey = null;
    this.walKey = null;
    this.walSalt = null;

    // Remove all event listeners
    this.eventEmitter.removeAllListeners();
  }

  // Event handling
  on(event, listener) {
    this.eventEmitter.on(event, listener);
  }

  removeListener(event, listener) {
    this.eventEmitter.removeListener(event, listener);
  }
}

/**
 * Generate secure encryption key
 */
function generateEncryptionKey() {
  return crypto.randomBytes(32);
}

/**
 * Create database instance with secure defaults
 */
function createSecureDatabase(databaseDir, encryptionKey = null, options = {}) {
  return new SlimCryptDB(
    databaseDir,
    encryptionKey || generateEncryptionKey(),
    {
      encrypt: true,
      compression: true,
      walEnabled: true,
      syncWrites: true,
      ...options,
    }
  );
}

module.exports = {
  SlimCryptDB,
  generateEncryptionKey,
  createSecureDatabase,
};
