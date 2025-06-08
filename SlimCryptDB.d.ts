// Type definitions for SlimCryptDB v2.1.0 - Enhanced with WAL Encryption
// Project: SlimCryptDB
// Definitions by: SlimCryptDB Contributors

/// <reference types="node" />

import { EventEmitter } from 'events';

declare namespace SlimCryptDB {
    interface DatabaseOptions {
        encrypt?: boolean;
        compression?: boolean;
        walEnabled?: boolean;
        syncWrites?: boolean;
        maxWalSize?: number;
        checkpointInterval?: number;
        lockTimeout?: number;
        walPaddingSize?: number;
    }

    interface JSONSchema {
        type?: string;
        properties?: { [key: string]: JSONSchema };
        required?: string[];
        items?: JSONSchema;
        enum?: any[];
        format?: string;
        minLength?: number;
        maxLength?: number;
        minimum?: number;
        maximum?: number;
        pattern?: string;
        additionalProperties?: boolean;
    }

    interface QueryCondition {
        column: string;
        operator: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'like' | 'contains';
        value: any;
    }

    interface QueryFilter {
        operator: 'and' | 'or';
        conditions: QueryCondition[];
    }

    interface QuerySort {
        column: string;
        direction?: 'asc' | 'desc';
    }

    interface QueryJoin {
        table: string;
        on: string;
        type?: 'inner' | 'left' | 'right';
    }

    interface QueryOptions {
        filter?: QueryFilter;
        sort?: QuerySort;
        limit?: number;
        offset?: number;
        join?: QueryJoin;
    }

    interface IndexOptions {
        type?: 'btree' | 'hash';
        unique?: boolean;
    }

    interface DatabaseStats {
        tables: number;
        indexes: number;
        activeTransactions: number;
        walSequence: number;
        memoryUsage: NodeJS.MemoryUsage;
        uptime: number;
        locks: number;
        lockQueue: number;
        walEncrypted?: boolean; // New: Indicates if WAL encryption is enabled
    }

    interface WALEntry {
        sequence: number;
        timestamp: number;
        operation: any;
        checksum: string;
    }

    interface TransactionOptions {
        isolationLevel?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
    }

    interface IndexInfo {
        tableName: string;
        columns: string[];
        type: 'btree' | 'hash';
        unique: boolean;
        data: Map<string, any[]>;
    }

    type TransactionId = string;
    type EventType = 'add' | 'update' | 'delete' | 'createTable' | 'deleteTable' | 'createIndex' | 'commitTransaction' | 'rollbackTransaction';
}

declare class SlimCryptDB extends EventEmitter {
    /**
     * Creates a new SlimCryptDB instance
     * @param databaseDir Directory path for database storage
     * @param encryptionKey 32-byte encryption key (optional, generates if not provided)
     * @param options Configuration options
     */
    constructor(databaseDir: string, encryptionKey?: Buffer | null, options?: SlimCryptDB.DatabaseOptions);

    /**
     * Create a new table with optional schema validation
     * @param tableName Name of the table to create
     * @param schema Optional JSON schema for validation
     */
    createTable(tableName: string, schema?: SlimCryptDB.JSONSchema | null): Promise<void>;

    /**
     * Delete a table and all its data
     * @param tableName Name of the table to delete
     */
    deleteTable(tableName: string): Promise<void>;

    /**
     * Check if a table exists
     * @param tableName Name of the table to check
     * @returns True if table exists, false otherwise
     */
    tableExists(tableName: string): boolean;

    /**
     * Add data to a table with validation and indexing
     * @param tableName Name of the table
     * @param data Data object to insert
     * @param transactionId Optional transaction ID for atomic operations
     * @returns The inserted data with generated ID
     */
    addData(tableName: string, data: any, transactionId?: SlimCryptDB.TransactionId | null): Promise<any>;

    /**
     * Read data from a table with basic filtering
     * @param tableName Name of the table
     * @param query Simple key-value filter object
     * @returns Array of matching records
     */
    readData(tableName: string, query?: Record<string, any>): Promise<any[]>;

    /**
     * Update data in a table
     * @param tableName Name of the table
     * @param filter Filter to select records to update
     * @param updateData Data to update
     * @param transactionId Optional transaction ID
     * @returns Number of updated records
     */
    updateData(tableName: string, filter: Record<string, any>, updateData: Record<string, any>, transactionId?: SlimCryptDB.TransactionId | null): Promise<number>;

    /**
     * Delete data from a table
     * @param tableName Name of the table
     * @param filter Filter to select records to delete
     * @param transactionId Optional transaction ID
     * @returns Number of deleted records
     */
    deleteData(tableName: string, filter: Record<string, any>, transactionId?: SlimCryptDB.TransactionId | null): Promise<number>;

    /**
     * Query data with advanced filtering, sorting, and pagination
     * @param tableName Name of the table
     * @param query Advanced query options
     * @returns Array of matching records
     */
    queryData(tableName: string, query?: SlimCryptDB.QueryOptions): Promise<any[]>;

    /**
     * Create an index for faster queries
     * @param tableName Name of the table
     * @param indexName Name of the index
     * @param columns Array of column names to index
     * @param options Index configuration options
     */
    createIndex(tableName: string, indexName: string, columns: string[], options?: SlimCryptDB.IndexOptions): Promise<void>;

    /**
     * Drop an index
     * @param indexName Name of the index to drop
     */
    dropIndex(indexName: string): Promise<void>;

    /**
     * Start a new transaction
     * @param isolationLevel Transaction isolation level
     * @returns Transaction ID
     */
    startTransaction(isolationLevel?: SlimCryptDB.TransactionOptions['isolationLevel']): Promise<SlimCryptDB.TransactionId>;

    /**
     * Commit a transaction atomically
     * @param transactionId Transaction ID to commit
     */
    commitTransaction(transactionId: SlimCryptDB.TransactionId): Promise<void>;

    /**
     * Rollback a transaction
     * @param transactionId Transaction ID to rollback
     */
    rollbackTransaction(transactionId: SlimCryptDB.TransactionId): Promise<void>;

    /**
     * Get database statistics and performance metrics
     * @returns Database statistics object
     */
    getStats(): Promise<SlimCryptDB.DatabaseStats>;

    /**
     * Gracefully close the database
     */
    close(): Promise<void>;

    /**
     * Event handlers
     */
    on(event: 'add', listener: (tableName: string, data: any) => void): this;
    on(event: 'update', listener: (tableName: string, recordsUpdated: any[], updateData: any) => void): this;
    on(event: 'delete', listener: (tableName: string, recordsDeleted: any[]) => void): this;
    on(event: 'createTable', listener: (tableName: string, tableData: any) => void): this;
    on(event: 'deleteTable', listener: (tableName: string) => void): this;
    on(event: 'createIndex', listener: (tableName: string, indexName: string) => void): this;
    on(event: 'commitTransaction', listener: (transactionId: SlimCryptDB.TransactionId) => void): this;
    on(event: 'rollbackTransaction', listener: (transactionId: SlimCryptDB.TransactionId) => void): this;

    removeListener(event: SlimCryptDB.EventType, listener: (...args: any[]) => void): this;

    // Enhanced private methods (for documentation purposes)
    private _deriveWALKey(): Buffer | null;
    private _encryptWALData(data: any): string;
    private _decryptWALData(encryptedData: string): any;
    private _applyWALPadding(plaintext: string): string;
    private _removeWALPadding(paddedText: string): string;
    private _initializeWALEncryption(): Promise<void>;
}

/**
 * Generate a cryptographically secure 256-bit encryption key
 * @returns 32-byte Buffer containing the encryption key
 */
declare function generateEncryptionKey(): Buffer;

/**
 * Create a secure database instance with recommended defaults
 * @param databaseDir Directory path for database storage
 * @param options Configuration options
 * @returns SlimCryptDB instance with secure defaults
 */
declare function createSecureDatabase(databaseDir: string, encryptionKey?: Buffer | null, options?: SlimCryptDB.DatabaseOptions): SlimCryptDB;

export {
    SlimCryptDB,
    generateEncryptionKey,
    createSecureDatabase
};

export default SlimCryptDB;
