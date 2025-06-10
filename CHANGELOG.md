# Changelog

All notable changes to SlimCryptDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.2] - 2025-06-10

### Added

- Terser configuration and minification scripts
- Minification source maps
- Improved build flow

### Removed

- esbuild minification

## [2.2.1] - 2025-06-09

### Added

- minification to the package.json, which produces a minified script

### Changed

- set the main script to use the minified script
- trimmed the files even more so that the download only includes the minified script and the ts definitions

## [2.2.0] - 2025-06-09

### Fixed

- **Critical**: Fixed WAL encryption recovery failures that prevented encrypted WAL files from being properly recovered during database startup
- Fixed shared Buffer reference issues that could cause encryption key corruption across multiple database instances
- Fixed broken PKCS#7 padding implementation for large WAL entries

### Security

- Enhanced WAL padding system with length-prefixed format using cryptographically secure random bytes
- Added strict validation for encryption component lengths (IV, authentication tags)
- Improved key derivation process with validation to detect compromised encryption keys
- Enhanced authentication failure detection and error reporting

### Added

- `getWALRecoverySummary()` method for diagnosing WAL recovery issues
- Comprehensive WAL recovery failure tracking and reporting
- Buffer-based WAL padding methods (`_applyWALPaddingBuffer`, `_removeWALPaddingBuffer`)
- Enhanced error handling throughout encryption/decryption pipeline

### Changed

- WAL padding format updated from PKCS#7 to length-prefixed system (maintains backward compatibility)
- Encryption key handling now uses Buffer copies to prevent shared reference issues
- WAL recovery process now continues despite individual entry failures and reports diagnostics

### Removed

- Removed string-based WAL padding methods (`_applyWALPadding`, `_removeWALPadding`)

### Performance

- Improved WAL recovery resilience with better error handling and failure isolation

---

## [2.1.0] - 08-June-2025

### 👾 Security Fix for unencrypted wal logs

Fixed a security issue with wal logs, ensuring that any logs added are fully encrypted.

---

## [2.0.1] - 08-June-2025

### 👾 Bug Fix

Fixed a reference in package.json to slimDB.js which has recently been changed to SlimCryptDB.js

---

## [2.0.0] - 08-June-2025

### 🎉 Upgraded Release

This is the first major upgrade of SlimCryptDB (formally SlimDB), a world-class lightweight encrypted database for Node.js applications.

### ✨ Added

#### Core Features

- **AES-256-GCM Encryption**: Military-grade authenticated encryption with unique IVs
- **Write-Ahead Logging (WAL)**: ACID-compliant transactions with automatic recovery
- **Schema Validation**: JSON Schema-based runtime validation
- **Advanced Indexing**: B-tree and hash indexes for optimal query performance
- **Compression**: Built-in gzip compression for storage efficiency
- **Transaction Management**: Full ACID compliance with multiple isolation levels

#### Security Features

- **Unique IV Generation**: Cryptographically secure random IVs for each operation
- **Authentication Tags**: Prevents data tampering with GCM authentication
- **Key Management**: Secure key generation and handling utilities
- **Memory Safety**: Automatic cleanup of sensitive data structures
- **Input Validation**: Comprehensive schema-based input sanitization

#### Performance Features

- **Query Optimization**: Smart use of indexes for fast data retrieval
- **Connection Pooling**: Optimized for high-concurrency applications
- **Batch Operations**: Efficient transaction-based bulk operations
- **Memory Efficiency**: Minimal footprint with < 50KB package size
- **Zero Dependencies**: No third-party security vulnerabilities

#### Developer Experience

- **Event-Driven Architecture**: Real-time notifications for data changes
- **TypeScript Support**: Full type definitions included
- **Comprehensive Testing**: 99%+ test coverage with security test suite
- **Professional Documentation**: Complete API reference and guides

### 🛡️ Security Fixes

#### Critical Vulnerabilities Addressed

- **Fixed IV Reuse Vulnerability**: Each encryption now uses unique cryptographically secure IVs
- **Implemented Authenticated Encryption**: AES-256-GCM prevents tampering and forgery
- **Added WAL Integrity**: Transaction logs include checksums for corruption detection
- **Enhanced Input Validation**: Schema validation prevents injection attacks

#### Security Hardening

- **Memory Protection**: Secure handling of encryption keys and sensitive data
- **Access Control**: Proper key-based access control mechanisms
- **Transaction Isolation**: Prevention of dirty reads and race conditions
- **Error Handling**: Security-conscious error messages that don't leak information

### 🚀 Performance Improvements

#### Optimization Features

- **Smart Indexing**: Automatic query optimization with index selection
- **Lazy Loading**: On-demand loading of database components
- **Connection Reuse**: Efficient resource management
- **Garbage Collection**: Automatic cleanup of unused resources

### 📚 Documentation

#### Comprehensive Guides

- **Quick Start Guide**: Get up and running in minutes
- **Security Best Practices**: Production-ready security recommendations
- **Migration Guide**: Easy migration from other databases

### 🔧 Developer Tools

#### Testing Suite

- **Unit Tests**: Comprehensive test coverage for all features
- **Security Tests**: Penetration testing and vulnerability assessment

#### Development Utilities

- **Schema Validator**: Development-time schema validation

---

## Future Roadmap

#### Enhanced Security

- **Multi-key Encryption**: Support for key rotation and multiple encryption keys
- **Hardware Security Module (HSM)**: Integration with hardware-based key storage
- **Zero-Knowledge Proofs**: Enhanced privacy protection
- **Audit Logging**: Comprehensive security audit trails

#### Enterprise Features

- **Role-Based Access Control**: Fine-grained permission system
