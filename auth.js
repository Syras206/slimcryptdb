const crypto = require("crypto");

class auth {

	constructor(db, secretKey) {
		this.db = db
		this.secretKey = secretKey
	}

	async authorise() {
		// get the keyData from the secret key
		return await this.db.queryData('_key', {
			secretKey: this.secretKey,
		})
			.then(keys => {
				return {
					databases: keys.map(key => key.dbName),
					encryptionKey: Object.values(keys)[0]?.encryptionKey,
					header: crypto.randomBytes(16).toString('hex')
				}
			})
    }

}

module.exports = auth;