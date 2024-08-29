const api = require('../api.js')
const express = require('express')
const slimDB = require('../slimDB.js')

// these example values would be defined in an env file for security
const dbPath = './data'
const encryptionKey = 'EXAMPLE8A1254B8B2CE967F543DAE1FB'
const mode = 'production'
const port = 3070
const db = new slimDB(dbPath, encryptionKey, mode)

// initialise express
const app = express()
app.use(express.static('public'))

// set up the api endpoints
new api(app, db)

// initialise the listener
app.listen(port, () => {
	console.log(`Server listening on port ${port}`)
	console.log(`In order to use the API you must first add values to the keys table for each database, then authorise the key using the auth endpoint in order to get an x-auth value`)
})