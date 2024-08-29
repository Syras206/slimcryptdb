const fs = require("fs");
const crypto = require("crypto");
const EventEmitter = require("events");

class slimDB {

	constructor(databaseDir, encryptionKey) {
		this.databaseDir = databaseDir;
		this.encryptionKey = encryptionKey;
		this.eventEmitter = new EventEmitter();
		this.indexes = new Map();
		this.locks = new Map();
		this.transactions = new Map();
	}

	async acquireLock(tableName, transactionId) {
		const timeout = 5000; // 5 second timeout
		const start = Date.now();

		while (true) {
			const lock = this.locks.get(tableName);

			if (!lock) {
				// table is not locked, lock it
				this.locks.set(tableName, transactionId);
				return;
			}

			if (lock === transactionId) {
				// table is already locked by this transaction, do nothing
				return;
			}

			await new Promise((resolve) => {
				const remainingTime = timeout - (Date.now() - start);
				if (remainingTime <= 0) {
					throw new Error(`Timed out waiting for lock on ${tableName}`);
				}
				setTimeout(resolve, Math.min(remainingTime, 100)); // wait at most 100ms
			});
		}
	}

	async addData(tableName, data, transactionId) {
		try {
			// get or create the transaction
			transactionId ??= await this.startTransaction();
			// validate the transaction first
			this.validateTransaction(transactionId);
			// get the transaction object from the map
			const transaction = this.transactions.get(transactionId);

			await this.acquireLock(tableName);

			// get the current data from the table based off the query
			const existingData = await this.readData(tableName, {});

			// get the new id key
			const newIdKey = data.id ?? crypto.randomBytes(16).toString('hex');

			// check if the new id key exists in the existing data
			if (existingData.filter(data => data.id === newIdKey).length > 0) {
				throw new Error(`Table '${tableName}' already has an id key with value '${newIdKey}'`);
			}
			// patch in the id to the data if its not already there
			data.id = newIdKey;

			// merge the updatedData object into the rows array
			var updatedData = existingData;
			updatedData.push(data);

			this.releaseLock(tableName);

			// write the filtered data to the database
			transaction.operations.push({
				type: "write",
				tableName,
				data: updatedData,
			});

			this.eventEmitter.emit('add', tableName, data);

			// commit the transaction
			await this.commitTransaction(transactionId);
		} catch (error) {
			// rollback the transaction
			await this.rollbackTransaction(transactionId);
			throw error;
		}
	}

	async commitTransaction(transactionId) {
		// validate the transaction first
		await this.validateTransaction(transactionId);

		// get the transaction object from the map
		const { operations } = this.transactions.get(transactionId);

		// loop through the operations in the transaction and execute them
		for (const {type, tableName, query, data } of operations) {
			switch (type) {
				case 'add':
					await this.addData(tableName, data);
					break;

				case 'delete':
					await this.deleteData(tableName, query);
					break;

				case 'update':
					await this.updateData(tableName, query, data);
					break;

				case 'read':
					await this.readData(tableName, query);
					break;

				case 'query':
					await this.queryData(tableName, query);
					break;

				case 'write':
					await this.writeData(tableName, data);
					break;

				default:
					throw new Error(`Unknown operation type: ${type}`);
			}
		}

		// remove the transaction from the map
		this.transactions.delete(transactionId);

		// emit the commit event
		this.eventEmitter.emit('commitTransaction', transactionId);

		console.log(`Transaction '${transactionId}' committed successfully.`);

		// resolve the promise
		return Promise.resolve();
	}

	async createIndex(tableName, indexName, keys, transactionId) {
		const data = await this.readData(tableName);
		const index = new Map();

		for (const item of data) {
			const indexKey = keys.map((key) => item[key]).join("_");
			if (!index.has(indexKey)) {
				index.set(indexKey, []);
			}
			index.get(indexKey).push(item);
		}

		this.indexes.set(indexName, index);

		if (transactionId) {
			const { indexes } = this.transactions.get(transactionId);
			indexes.set(indexName, index);
		}
	}

	async createTable(tableName, schema) {
		const table = {
			name: tableName,
			schema,
			rows: [],
		};

		const filePath = `${this.databaseDir}/${tableName}.db`;

		if (fs.existsSync(filePath)) {
			throw new Error(`Table ${tableName} already exists`);
		}

		const encryptedData = this.encryptData(table);
		await fs.promises.writeFile(filePath, encryptedData);

		this.eventEmitter.emit('createTable', tableName, table);
		console.log(`Table '${tableName}' created successfully.`);

		// If the schema includes an index, create the index
		if (schema.index) {
			const { indexName, keys } = schema.index;
			await this.createIndex(tableName, indexName, keys);
		}
	}

	decryptData(data) {
		const key = this.encryptionKey;

		// Get the Initialization Vector (IV) and encrypted value from the provided data string
		const [ivString, encryptedString] = data.split(':');

		// Convert the IV and encrypted value into Buffer objects
		const iv = Buffer.from(ivString, 'hex');
		const encrypted = Buffer.from(encryptedString, 'hex');

		// Create a Decipher using the 256-bit Advanced Encryption Standards (AES) in Cipher Block Chaining (CBC) mode with the provided key and IV
		const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);

		try {
			// Generate a decrypted value from the provided data
			const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
			// Return the decrypted value
			return JSON.parse(decrypted.toString());
		} catch (error) {
			throw new Error('Decryption failed. Are you sure your encryption key is correct?')
		}
	}


	async deleteData(tableName, query, transactionId) {
		try {
			// get or create the transaction
			transactionId ??= await this.startTransaction();
			// validate the transaction first
			this.validateTransaction(transactionId);
			// get the transaction object from the map
			const transaction = this.transactions.get(transactionId);

			// lock the table
			await this.acquireLock(tableName);

			// get all data from the database
			const existingData = await this.readData(tableName, {});

			// remove records that match the query
			var removedData = [];
			const filteredData = existingData.filter(item => {
				return !Object.keys(query).every(key => {
					// if we are dealing with regex then use regex to test if the item matches the query
					if (query[key] instanceof RegExp) {
						if (query[key].test(item[key])) {
							// the item matches the query, add the item to the list of items being deleted
							removedData[key] = item[key];
							// return true to filter out the item
							return true;
						}
					}
					// otherwise just check if the item matches the query
					if (item[key] === query[key]) {
						// the item matches the query, add the item to the list of items being deleted
						removedData[key] = item[key];
						// return true to filter out the item
						return true;
					};
				});
			});

			// release the lock at this point because the writeData operation will handle its own locking
			this.releaseLock(tableName);

			// write the filtered data to the database
			transaction.operations.push({
				type: "write",
				tableName,
				data: filteredData,
			});

			// emit the delete event
			this.eventEmitter.emit('delete', tableName, removedData);

			// commit the transaction
			await this.commitTransaction(transactionId);
		} catch (error) {
			// log that the transaction failed
			console.log(`Transaction '${transactionId}' failed.`);
			console.log(error);
			// rollback the transaction
			await this.rollbackTransaction(transactionId);
			throw error;
		}
	}

	async deleteTable(tableName) {
		await this.acquireLock(tableName);

		const filePath = `${this.databaseDir}/${tableName}.db`;

		if (!fs.existsSync(filePath)) {
			throw new Error(`Table ${tableName} does not exist`);
		}

		await fs.promises.unlink(filePath);

		this.releaseLock(tableName);

		this.eventEmitter.emit('deleteTable', tableName);

		console.log(`Table '${tableName}' deleted successfully.`);
	}

	encryptData(data) {
		const key = this.encryptionKey;
		// Generate an Initialization Vector (IV) and store as constant
		const iv = crypto.randomBytes(16);

		// Create a Cipher using the 256-bit Advanced Encryption Standards (AES) in Cipher Block Chaining (CBC) mode with the provided key and IV
		const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);

		// Generate an encrypted value from the provided data
		const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);

		// Return both the generated IV and encrypted value
		return iv.toString('hex') + ':' + encrypted.toString('hex');
	}

	filterCondition = (item, { column, operator, value }) => {
		switch (operator) {
			case ">":
				return item[column] > value;
			case "<":
				return item[column] < value;
			case ">=":
				return item[column] >= value;
			case "<=":
				return item[column] <= value;
			case "==":
				return item[column] === value;
			case "!=":
				return item[column] !== value;
			case "like":
				// use regex to test if the item is similar to the query non case sensitive
				return new RegExp(value, "i").test(item[column]);
			case "contains":
				// use regex to test if the item contains the query case sensitive
				return new RegExp(value).test(item[column]);
			default:
				throw new Error(`Invalid operator: ${operator}`);
		}
	}

	filterData = (data, { operator, conditions }) => {
		switch (operator) {
			case "and":
				return data.filter((item) =>
					conditions.every((condition) => this.filterCondition(item, condition))
				);
			case "or":
				return data.filter((item) =>
					conditions.some((condition) => this.filterCondition(item, condition))
				);
			default:
				throw new Error(`Invalid operator: ${operator}`);
		}
	}

	isObject(val) {
		return val !== null && typeof val === 'object';
	}

	isPositiveNumber(val) {
		return typeof val === 'number' && val > -1;
	}

	isValidEncryptionKey(val) {
		return val.length === 32;
	}

	async joinData(data, { joinTable, joinKey, joinForeignKey, joinSelect }) {
		const joinableData = await this.readData(joinTable);
		data = data.map(row => {
			const joinItem = joinableData.find(j => j[joinForeignKey] === row[joinKey]);
			return joinItem
				? { ...row, ...joinItem }
				: row;
		});

		if (joinSelect) {
			data = data.map(row => {
				const { joinSelect: select, ...rest } = row;
				const selectData = Object.fromEntries(select.map(key => [key, row[key]]));
				return { ...selectData, ...rest };
			});
		}

		return data;
	}

	on(event, listener) {
		this.eventEmitter.on(event, listener);
	}

	paginateData(data, limit, offset) {
		return data.slice(offset, offset + limit);
	}

	async queryData(tableName, { filter, sort, limit, offset, join }) {
		// Get all data from the table
		const data = await this.readData(tableName, {});

		// Apply joins
		const joinedData = join
			? await this.joinData(data, join)
			: data;

		// Apply filtering
		const filteredData = filter
			? this.filterData(joinedData, filter)
			: joinedData;

		// Apply sorting
		const sortedData = sort
			? this.sortData(filteredData, sort)
			: filteredData;

		// Apply pagination
		const paginatedData = (limit || offset)
			? this.paginateData(sortedData, limit, offset)
			: sortedData;

		return paginatedData;
	}

	async readData(tableName, query = {}) {
		try {
			const filePath = `${this.databaseDir}/${tableName}.db`;
			const data = await fs.promises.readFile(filePath, "utf8");
			const decryptedData = this.decryptData(data);

			const results = decryptedData.rows.filter((item) => {
				// if the item is not an object then skip it
				if (!this.isObject(item)) return false;
				// if the query is empty then include all items
				if (!Object.entries(query).length) return true
				// this is an object so check if the item matches the query
				return Object.entries(query).every(([key, value]) => {
					const isRegExp = value instanceof RegExp;
					return isRegExp
						? value.test(item[key])
						: item[key] === value;
				})
			});

			return results;
		} catch (error) {
			console.error(`Error reading data from file ${tableName}:`, error);
			throw error;
		}
	}

	async releaseLock(tableName, transactionId) {
		const lock = this.locks.get(tableName);
		if (lock === transactionId) this.locks.delete(tableName);
	}

	removeListener(event, listener) {
		this.eventEmitter.removeListener(event, listener);
	}

	async rollbackTransaction(transactionId) {
		// validate the transaction first
		await this.validateTransaction(transactionId);

		// remove the transaction from the map
		this.transactions.delete(transactionId);
	}

	async startTransaction() {
		const transactionId = crypto.randomBytes(16).toString("hex");
		this.transactions.set(transactionId, {
			operations: [],
			indexes: new Map(),
			data: new Map(),
			joinedData: new Map(),
			validatedIndexes: new Map(),
		});

		return transactionId;
	}

	sortData(data, { column, direction }) {
		return data.sort((a, b) => {
			const aValue = a[column];
			const bValue = b[column];

			if (aValue < bValue) {
				return direction === "asc" ? -1 : 1;
			} else if (aValue > bValue) {
				return direction === "asc" ? 1 : -1;
			}
			// for any other values, return 0
			return 0;
		});
	}

	async updateData(tableName, query, data, transactionId) {
		try {
			// get or create the transaction
			transactionId ??= await this.startTransaction();
			// validate the transaction first
			this.validateTransaction(transactionId);
			// get the transaction object from the map
			const transaction = this.transactions.get(transactionId);

			// lock the table
			await this.acquireLock(tableName);

			// get the current data from the table based off the query
			const existingData = await this.readData(tableName, query);

			const updatedData = existingData.map(item => {
				// Check if any fields have actually changed before updating
				const hasChanged = Object.keys(data).some(key => item[key] !== data[key]);
				return hasChanged
					? Object.assign({}, item, data)
					: item;
			});

			// merge the updatedData object into the rows array
			updatedData.forEach(item => existingData[item.id] = item)

			this.releaseLock(tableName);

			// write the filtered data to the database
			transaction.operations.push({
				type: "write",
				tableName,
				data: updatedData,
			});

			this.eventEmitter.emit('add', tableName, data);

			// commit the transaction
			await this.commitTransaction(transactionId);

			return updatedData;
		} catch (error) {
			// rollback the transaction
			await this.rollbackTransaction(transactionId);
			throw error;
		}
	}

	async validateIndex(tableName, indexName, transactionId) {
		const index = this.indexes.get(indexName);

		if (!index) throw new Error(`Index "${indexName}" does not exist.`);

		// If the index has already been validated in the current transaction, skip reading the data
		if (transactionId && this.transactions.has(transactionId)) {
			const transaction = this.transactions.get(transactionId);
			if (transaction.validatedIndexes.has(indexName)) {
				return;
			}
		}

		// Read data
		const data = await this.readData(tableName);

		// Iterate over data and validate index
		for (const item of data) {
			let foundIndexKey = null;
			for (const indexKey of index.keys()) {
				const values = indexKey.split('_');
				const itemValues = `${item[values[0]]}_${item[values[1]]}`;
				if (indexKey === itemValues) {
					foundIndexKey = indexKey;
					break;
				}
			}

			if (foundIndexKey) {
				const items = index.get(foundIndexKey);

				if (!items.includes(item)) {
					throw new Error(`Index "${indexName}" is not in sync with data.`);
			}
			}
		}

		// If transaction ID is provided, add the index validation to the transaction object
		if (transactionId) {
			this.validateTransaction(transactionId);
			const transaction = this.transactions.get(transactionId);
			transaction.validatedIndexes.add(indexName);
		}
	}

	async validateTransaction(transactionId) {
		// check if the transaction ID exists in the transactions map
		if (!this.transactions.has(transactionId)) {
			throw new Error(`Transaction ${transactionId} does not exist`);
		}
	}

	/**
	 * This method will overwrite the rows in the database with the new data.
	 */
	async writeData(tableName, data) {
		// lock the table
		await this.acquireLock(tableName);

		// Write data
		const filePath = `${this.databaseDir}/${tableName}.db`;
		const tableData = await fs.promises.readFile(filePath, "utf8");
		const decryptedTable = this.decryptData(tableData);

		// overwrite the data with the new data
		decryptedTable.rows = data;

		// encrypt the table
		const encryptedData = this.encryptData(decryptedTable);
		await fs.promises.writeFile(filePath, encryptedData);

		this.eventEmitter.emit('write', tableName, data);

		this.releaseLock(tableName);
	}

}

module.exports = slimDB;