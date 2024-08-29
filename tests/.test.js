const crypto = require("crypto");
const slimDB = require('../slimDB.js');
const encryptionKey = 'EXAMPLE8A1254B8B2CE967F543DAE1FB';
const db = new slimDB('./data', encryptionKey);
const tableName = 'myTestTable' + crypto.randomBytes(4).toString('hex');

describe('Test table CRUD', () => {
	test('deleteTable should throw an error because the table does not exist', async () => {
		await expect(db.deleteTable(tableName)).rejects.toThrow(`Table ${tableName} does not exist`);
	});

	test('createTable should resolve without any errors', async () => {
        const schema = {
            name: 'test-table',
			columns: [
				{
					name: 'id',
					type: 'INTEGER',
				},
				{
					name: 'name',
					type: 'TEXT',
				},
				{
					name: 'age',
					type: 'INTEGER',
				}
			],
			index: [
				{
					indexName: 'id',
					keys: ['id'],
				}
			]
        }

        await expect(db.createTable(tableName, schema)).resolves.toBeUndefined();
    });

	test('createTable should throw an error because the table already exists', async () => {
        const schema = {
            name: 'test-table',
            dataType: 'object'
        }

        await expect(db.createTable(tableName, schema)).rejects.toThrow(`Table ${tableName} already exists`);
    });

	test('addData should add new data to the database table', async () => {
        const addedData = { name: 'Jane', age: 25 };
        await db.addData(tableName, addedData);
        const allData = await db.readData(tableName, {});
        expect(allData).toContainEqual(addedData);
    });

	test('readData should return data array that match query criteria', async () => {
        const query = { name: 'Jane' };
        const data = await db.readData(tableName, query);

        expect(Array.isArray(data)).toBeTruthy();
        expect(data[0].name).toEqual('Jane');
    });

	test('updateData should update data that matches query criteria', async () => {
        const query = { name: 'Jane' };
        const updatedData = { age: 30 };
        const result = await db.updateData(tableName, query, updatedData);

        expect(result[0].age).toEqual(30);
    });

	test('readData should return data array that match query criteria', async () => {
        const query = { name: 'Jane' };
        const data = await db.readData(tableName, query);

        expect(Array.isArray(data)).toBeTruthy();
        expect(data[0]).toMatchObject(query);
    });

	test('queryData should return data array that match query criteria', async () => {
		const options = {
			filter: {
				operator: 'and',
				conditions: [
					{
						column: 'name',
						operator: '==',
						value: 'Jane',
					},
				]
			},
		}
		const data = await db.queryData(tableName, options);
		expect(data[0]).toMatchObject({ name: 'Jane' });
	})
});

describe('Test transactions', () => {
	test('commitTransaction should execute all queries for given transaction', async () => {
		await db.startTransaction()
			.then(
				async (transactionId) => {
					var transaction = db.transactions.get(transactionId);
					transaction.operations.push({
						type: 'add',
						tableName: tableName,
						data: { name: 'Bob', age: 40 },
					})
					transaction.operations.push({
						type: 'add',
						tableName: tableName,
						data: { name: 'Builder', age: 10 },
					})
					// commit the transaction - execute all queries
					await db.commitTransaction(transactionId)
						.then(async () => {
							// test the first request was successful
							const firstResult = await db.readData(tableName, { name: 'Bob' });
							expect(firstResult[0].age).toEqual(40);
							// test the second request was successful
							const secondResult = await db.readData(tableName, { name: 'Builder' });
							expect(secondResult[0].age).toEqual(10);
						});
				}
			);
    });

	test('rollbackTransaction should undo all changes made to the database within the scope of the transaction', async () => {
        await db.startTransaction()
			.then(
				async (transactionId) => {
					var transaction = db.transactions.get(transactionId);
					transaction.operations.push({
						type: 'update',
						tableName: tableName,
						query: { name: 'Bob' },
						data: { age: 41 },
					})
					transaction.operations.push({
						type: 'add',
						tableName: tableName,
						data: { id: 99, name: 'Sandy', age: 23 },
					})
					// rollback the transaction - discard all queries
					await db.rollbackTransaction(transactionId)
						.then(async () => {
							// test the first request was discarded
							const firstResult = await db.readData(tableName, { name: 'Bob' });
							expect(firstResult[0].age).toEqual(40);
							// test the second request was discarded
							const secondResult = await db.readData(tableName, { id: 99 });
							expect(secondResult).toEqual([]);
						});
				}
			);
    });
});

describe('Test class methods', () => {
	describe('encryptData() integration tests', () => {
		it('encryption key should match', () => {
			// Test the encryption key setup
			expect(db.encryptionKey).toEqual(encryptionKey);
		});
	});
	test('acquireLock should not throw error for valid input', async () => {
        await expect(db.acquireLock(tableName)).resolves.not.toThrow()
    });
});

describe('Test cleanup', () => {
	test('deleteData should delete data that matches query criteria', async () => {
		const query = { name: 'Jane' };
        const queriedDataBeforeDeletion = await db.readData(tableName, query);
		expect(queriedDataBeforeDeletion[0].name).toEqual('Jane');

		await db.deleteData(tableName, query)
			.then(
				async () => {
					const queriedDataAfterDeletion = await db.readData(tableName, query);
					expect(queriedDataAfterDeletion).toEqual([]);
				}
			);

	})
	test('deleteTable should delete the table with the given name without any errors', async () => {
		await expect(db.deleteTable(tableName)).resolves.toBeUndefined();
	});
});