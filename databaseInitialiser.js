class databaseInitialiser {

	constructor(db) {
		this.db = db
	}

	async addKeys() {
		try {
			// create a _key table
			await this.db.createTable('_key', {
				name: '_key',
				columns: [
					{
						name: 'id',
						type: 'INTEGER',
					},
					{
						name: 'secretKey',
						type: 'TEXT',
					},
					{
						name: 'dbName',
						type: 'TEXT',
					},
					{
						name: 'encryptionKey',
						type: 'TEXT',
					}
				],
				index: [
					{
						indexName: 'id',
						keys: ['id'],
					}
				]
			})
			console.log('keys DB setup')
		} catch {
			console.log('adding keys went wrong')
		}
	}

	async init() {
		await this.addKeys()
	}

}

module.exports = databaseInitialiser;