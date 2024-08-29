const crypto = require("crypto");

class auth {
    constructor(dbName, encryptionKey) {
        this.database = dbName;
        this.encryptionKey = encryptionKey;
        this.header = crypto.randomBytes(16).toString('hex');
    }
}

module.exports = auth;