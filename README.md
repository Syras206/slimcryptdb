# SlimCryptDB 🔐

**A minimalist, ultra-secure embedded database for Node.js applications**

[![npm version](https://badge.fury.io/js/slimcryptdb.svg)](https://badge.fury.io/js/slimcryptdb)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Security Rating](https://img.shields.io/badge/Security-A%2B-brightgreen.svg)](https://github.com/Syras206/slim-db)

SlimCryptDB is a lightweight encrypted database designed specifically for security-conscious applications, edge computing, IoT devices, and serverless environments where traditional databases are overkill. With zero external dependencies and military-grade encryption, it delivers enterprise-level security in a compact package optimized for resource-constrained environments.

## 🌟 Key Features

### 🛡️ Military-Grade Security
- **AES-256-GCM Encryption**: Unique IVs per operation with authentication
- **Tamper Evidence**: Dual SHA-256 + GCM integrity checks
- **Secure Key Handling**: CSPRNG-generated keys with optional env storage

### ⚡ Resource-Efficient Design
- **WAL with Crash Recovery**: Atomic transaction protection
- **Selective Compression**: Gzip for large datasets
- **Concurrent Access Control**: Async locking for parallel operations

### 🔧 Developer Ergonomics
- **Full CRUD + Transactions**: Atomic multi-operation support
- **Schema Validation**: Basic JSON type checking
- **Real-Time Events**: Change notifications via EventEmitter
- **Low-Code Setup**: Secure defaults with minimal config

### 📦 Edge/Native Ready
- **Tiny Footprint**: <50KB core implementation
- **Zero Dependencies**: Pure Node.js core modules
- **Cold Start Optimized**: Instant initialization


## 🚀 Quick Start

### Installation

```bash
npm install slimcryptdb
```

### Basic Usage

```javascript
const { SlimCryptDB, generateEncryptionKey } = require('slimcryptdb')

// Generate encryption key (do this once and store securely)
const encryptionKey = generateEncryptionKey()
console.log('Store this key securely:', encryptionKey.toString('hex'))

// Create database instance with the key
const db = new SlimCryptDB('./data', encryptionKey)

// wait until the database is ready
await db.ready()

// Define schema for data validation
const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    age: { type: 'number', minimum: 0, maximum: 150 }
  },
  required: ['name', 'email']
}

async function quickStart() {
  try {
    // Create table with validation
    await db.createTable('users', userSchema)

    // Add data (ID auto-generated if not provided)
    const user = await db.addData('users', {
      name: 'Alice Cooper',
      email: 'alice@example.com',
      age: 30
    })
    console.log('Created user:', user)

    // Update data
    await db.updateData('users',
      { id: user.id },
      { age: 31, lastLogin: new Date().toISOString() }
    )
    console.log('Updated user age')

    // Query with advanced filtering
    const adults = await db.queryData('users', {
      filter: {
        operator: 'and',
        conditions: [
          { column: 'age', operator: '>=', value: 18 }
        ]
      },
      sort: { column: 'name', direction: 'asc' }
    })
    console.log('Adult users:', adults)

    // Delete data
    const deleteCount = await db.deleteData('users', { age: 31 })
    console.log(`Deleted ${deleteCount} users`)

  } catch (error) {
    console.error('Database error:', error)
  } finally {
    await db.close()
  }
}

quickStart()
```

## 🔑 Secure Key Management

### Environment Variables (Recommended)

```javascript
// .env file
SLIMCRYPTDB_KEY=YOUR_KEY_HERE

// In your application
require('dotenv').config()

const encryptionKey = Buffer.from(process.env.SLIMCRYPTDB_KEY, 'hex')
const db = new SlimCryptDB('./data', encryptionKey)
```

### Key Generation and Storage

```javascript
const { generateEncryptionKey } = require(''slimcryptdb'')
const fs = require('fs')

// Generate new key (run once during setup)
const key = generateEncryptionKey()

// Store in environment file (don't commit to git!)
fs.appendFileSync('.env', `\nSLIMCRYPTDB_KEY=${key.toString('hex')}\n`)

// Or store in secure key management service
// AWS Secrets Manager, Azure Key Vault, etc.
```

### Production Key Management

```javascript
// Example: AWS Secrets Manager integration
const AWS = require('aws-sdk')
const secretsManager = new AWS.SecretsManager()

async function getDbKey() {
  const secret = await secretsManager.getSecretValue({
    SecretId: 'slimcryptdb-encryption-key'
  }).promise()

  return Buffer.from(secret.SecretString, 'hex')
}

// Usage
const encryptionKey = await getDbKey()
const db = new SlimCryptDB('./data', encryptionKey)
```

## 📊 Complete CRUD Operations

### Transaction Management

```javascript
// Atomic transaction with rollback support
const txnId = await db.startTransaction('READ_COMMITTED')

try {
  // Multiple operations in one transaction
  const user = await db.addData('users', {
    name: 'Bob Smith',
    email: 'bob@example.com'
  }, txnId)

  await db.updateData('users',
    { id: user.id },
    { verified: true, verifiedAt: new Date().toISOString() },
    txnId
  )

  // Commit all changes atomically
  await db.commitTransaction(txnId)
  console.log('Transaction completed successfully')

} catch (error) {
  // Automatic rollback on any error
  await db.rollbackTransaction(txnId)
  console.error('Transaction failed:', error)
}
```

### Advanced Queries

```javascript
// Complex filtering with multiple conditions
const premiumUsers = await db.queryData('users', {
  filter: {
    operator: 'and',
    conditions: [
      { column: 'age', operator: '>=', value: 25 },
      { column: 'verified', operator: '==', value: true },
      {
        operator: 'or',
        conditions: [
          { column: 'plan', operator: '==', value: 'premium' },
          { column: 'credits', operator: '>', value: 1000 }
        ]
      }
    ]
  },
  sort: { column: 'lastLogin', direction: 'desc' },
  limit: 50,
  offset: 0
})

// Bulk operations
const updateCount = await db.updateData('users',
  { verified: false },
  {
    status: 'pending_verification',
    updatedAt: new Date().toISOString()
  }
)
console.log(`Updated ${updateCount} unverified users`)
```

### High-Performance Indexing

```javascript
// Create indexes for faster queries
await db.createIndex('users', 'email_idx', ['email'], { unique: true })
await db.createIndex('users', 'name_age_idx', ['name', 'age'])

// Queries automatically use appropriate indexes
const userByEmail = await db.queryData('users', {
  filter: {
    operator: 'and',
    conditions: [
      { column: 'email', operator: '==', value: 'alice@example.com' }
    ]
  }
}) // Uses email_idx for O(1) lookup
```

## 📡 Real-Time Events

```javascript
// Listen for all data changes
db.on('add', (tableName, data) => {
  console.log(`New ${tableName} record:`, data.id)
  // Trigger real-time updates, notifications, etc.
})

db.on('update', (tableName, recordsUpdated, updateData) => {
  console.log(`Updated ${recordsUpdated.length} ${tableName} records`)
  // Cache invalidation, sync to other systems, etc.
})

db.on('delete', (tableName, recordsDeleted) => {
  console.log(`Deleted ${recordsDeleted.length} ${tableName} records`)
  // Cleanup related data, audit logging, etc.
})

db.on('commitTransaction', (transactionId) => {
  console.log(`Transaction ${transactionId.substring(0, 8)}... committed`)
  // Trigger post-transaction hooks
})
```

## 🔧 Configuration Options

```javascript
const db = new SlimCryptDB('./data', encryptionKey, {
  encrypt: true,              // Enable AES-256-GCM encryption (default: true)
  compression: true,          // Enable gzip compression (default: true)
  walEnabled: true,           // Enable Write-Ahead Logging (default: true)
  syncWrites: true,           // Synchronous writes for durability (default: true)
  maxWalSize: 50 * 1024 * 1024, // 50MB WAL limit (default: 100MB)
  checkpointInterval: 30000,  // Checkpoint every 30 seconds (default: 30000)
  lockTimeout: 10000          // Lock timeout in milliseconds (default: 10000)
})
```

## 🌐 Why Perfect for Edge Computing

### Minimal Resource Footprint

| Resource | SlimCryptDB | better-sqlite3 | Traditional DB |
|----------|-------------|----------------|----------------|
| **Install Size** | ~45KB | ~23MB | 100MB+ |
| **Memory Usage** | <5MB | 10-50MB | 100MB+ |
| **Startup Time** | <50ms | 100-500ms | 1000ms+ |
| **Dependencies** | 0 | 15+ | 50+ |

### Edge Computing Benefits

```javascript
// Perfect for IoT devices with limited storage
const edgeDb = new SlimCryptDB('/tmp/sensor-data', encryptionKey, {
  compression: true,  // Reduces storage by 70-80%
  walEnabled: false   // Disable for ultra-low storage if needed
})

// Handles offline scenarios gracefully
await edgeDb.addData('sensor_readings', {
  deviceId: 'temp-01',
  temperature: 23.5,
  humidity: 45.2,
  timestamp: Date.now(),
  location: { lat: 40.7128, lng: -74.0060 }
})

// When connection restored, sync with cloud
const unsyncedData = await edgeDb.queryData('sensor_readings', {
  filter: {
    operator: 'and',
    conditions: [
      { column: 'synced', operator: '!=', value: true }
    ]
  }
})
// Send unsyncedData to cloud...
```

### Real-World Storage Impact

For edge deployments across multiple devices:

```bash
# Traditional Setup (per device):
# better-sqlite3: 23MB
# 100 edge devices = 2.3GB total

# SlimCryptDB Setup (per device):
# SlimCryptDB: 45KB
# 100 edge devices = 4.5MB total

# Storage savings: 99.8% reduction!
```

### Bandwidth Optimization

```javascript
// Efficient for limited bandwidth environments
const compressedData = await db.queryData('events', {
  filter: {
    operator: 'and',
    conditions: [
      { column: 'timestamp', operator: '>', value: Date.now() - 86400000 }
    ]
  }
})

// Built-in compression means smaller sync payloads
// 1MB uncompressed → ~200KB compressed for transmission
```

## 🛡️ Security Features

### Encryption Details
- **Algorithm**: AES-256-GCM (Authenticated Encryption)
- **Key Size**: 256-bit (32 bytes)
- **IV Generation**: Cryptographically secure random per operation
- **Authentication**: Built-in tamper detection
- **Key Derivation**: PBKDF2 support for password-based keys

### Data Integrity
```javascript
// Automatic integrity verification
try {
  const data = await db.readData('sensitive_table', {})
  // Data automatically verified and decrypted
} catch (error) {
  if (error.message.includes('Decryption failed')) {
    console.error('Data integrity compromised!')
    // Handle potential tampering
  }
}
```

## 🔄 Migration Guide

### From better-sqlite3

```javascript
// Before (better-sqlite3)
const Database = require('better-sqlite3')
const db = new Database('mydb.sqlite')

const stmt = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)')
stmt.run('Alice', 'alice@example.com')

// After (SlimCryptDB)
const { SlimCryptDB, generateEncryptionKey } = require(''slimcryptdb'')
const db = new SlimCryptDB('./data', generateEncryptionKey())
await db.ready()

await db.createTable('users', {
  type: 'object',
  properties: {
    name: { type: 'string' },
    email: { type: 'string' }
  }
})

await db.addData('users', { name: 'Alice', email: 'alice@example.com' })
```

### From NeDB

```javascript
// Before (NeDB)
const Datastore = require('nedb')
const db = new Datastore({ filename: 'datafile.db', autoload: true })

db.insert({ name: 'Alice', email: 'alice@example.com' }, callback)

// After (SlimCryptDB)
const { SlimCryptDB, generateEncryptionKey } = require(''slimcryptdb'')
const db = new SlimCryptDB('./data', generateEncryptionKey())

await db.ready()
await db.createTable('users')
await db.addData('users', { name: 'Alice', email: 'alice@example.com' })
```

## 🚦 Best Practices

### Security
1. **Store encryption keys securely** - use environment variables or key management services
2. **Enable all security features** in production (encryption, WAL, validation)
3. **Regular key rotation** for high-security applications
4. **Monitor database events** for suspicious activity
5. **Backup encrypted databases** regularly

### Performance
1. **Create indexes** for frequently queried fields
2. **Use transactions** for batch operations
3. **Enable compression** for storage-constrained environments
4. **Monitor WAL size** and adjust checkpoint intervals
5. **Choose appropriate isolation levels** for your use case

### Edge Computing
1. **Disable WAL** if storage is extremely limited
2. **Use compression** to maximize storage efficiency
3. **Implement sync strategies** for offline-first applications
4. **Monitor resource usage** on constrained devices
5. **Plan for intermittent connectivity**

## 🤝 Use Cases

### Perfect For:
- **Edge Computing**: Ultralight databases for resource-constrained environments
- **IoT Applications**: Sensor data storage with minimal footprint
- **Serverless Functions**: Zero cold-start overhead, fits in deployment packages
- **Desktop Applications**: Offline-first apps with encrypted local storage
- **Microservices**: Dedicated data storage per service without external dependencies
- **Development & Testing**: Fast setup without Docker or external databases

### Consider Alternatives For:
- **High-concurrency web applications** (>100 concurrent write transactions)
- **Complex analytics workloads** requiring SQL joins and aggregations
- **Multi-node distributed systems** requiring eventual consistency
- **Applications requiring SQL compatibility** with existing tools

## 📚 API Reference

### Core Methods

#### Database Management
- `new SlimCryptDB(databaseDir, encryptionKey, options)` - Create database instance
- `createTable(tableName, schema?)` - Create table with optional validation
- `deleteTable(tableName)` - Remove table and all data
- `tableExists(tableName)` - Check if table exists
- `close()` - Graceful shutdown with cleanup

#### CRUD Operations
- `addData(tableName, data, transactionId?)` - Insert data with validation
- `readData(tableName, query?)` - Simple filtering and retrieval
- `updateData(tableName, filter, updateData, transactionId?)` - Update matching records
- `deleteData(tableName, filter, transactionId?)` - Delete matching records
- `queryData(tableName, query)` - Advanced queries with filtering, sorting, pagination

#### Transaction Management
- `startTransaction(isolationLevel?)` - Begin atomic transaction
- `commitTransaction(transactionId)` - Commit all operations
- `rollbackTransaction(transactionId)` - Rollback on error

#### Performance & Monitoring
- `createIndex(tableName, indexName, columns, options?)` - Create performance indexes
- `dropIndex(indexName)` - Remove index
- `getStats()` - Database statistics and metrics

### Utility Functions
- `generateEncryptionKey()` - Generate secure 256-bit key
- `createSecureDatabase(databaseDir, encryptionKey?, options?)` - Factory with secure defaults

## 🐛 Troubleshooting

### Common Issues

```javascript
// Issue: "Decryption failed"
// Cause: Wrong encryption key or corrupted data
// Solution: Verify key and check backups

// Issue: "Lock timeout"
// Cause: Long-running transactions
// Solution: Increase lockTimeout or optimize queries

// Issue: High memory usage
// Cause: Large result sets
// Solution: Use pagination with limit/offset

const results = await db.queryData('large_table', {
  limit: 100,
  offset: page * 100,
  sort: { column: 'id', direction: 'asc' }
})
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Running Tests

```bash
npm test # Run all tests
npm run test:security # Run security tests
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

SlimCryptDB is built with security and performance in mind, leveraging:
- Node.js crypto module for secure encryption
- JSON Schema for robust data validation
- Write-Ahead Logging principles for data integrity
- Modern compression algorithms for storage efficiency

---

**Ready to secure your edge applications?** Start with SlimCryptDB today and join developers building the next generation of secure, distributed applications.

```bash
npm install slimcryptdb
```