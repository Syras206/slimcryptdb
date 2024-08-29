const databaseInitialiser = require('../databaseInitialiser.js')
const slimDB = require('../slimDB.js')

// these example values would be defined in an env file for security
const dbPath = './data'
const encryptionKey = 'EXAMPLE8A1254B8B2CE967F543DAE1FB'
const mode = 'production'
const db = new slimDB(dbPath, encryptionKey, mode)

// set up the core databases
new databaseInitialiser(db).init()

// add an example database
