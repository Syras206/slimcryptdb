const express = require('express')
const bodyParser = require("body-parser")
const fs = require('fs')
const path = require('path')
const app = express()
const files = fs.readdirSync('./data')
const slimDB = require('./slimDB.js')
const EventEmitter = require("events");
const auth = require('./auth')

app.use(bodyParser.json())

app.authorise = async (req) => {
	const xAuth = req.header('x-auth')
	let authorised = false
	if (typeof app.authoriser !== 'undefined') {
		if (xAuth === app.authoriser.header) authorised = true
	}
	if (!authorised) throw new Error('Forbidden')

	return {
		database: app.authoriser.database,
		encryptionKey: app.authoriser.encryptionKey
	}
}

app.getData = async (dbName, encryptionKey, options) => {
	const db= new slimDB('./data', encryptionKey)
	return await db.queryData(dbName, options);
}

app.addData = async (dbName, encryptionKey, data) => {
	const db= new slimDB('./data', encryptionKey)
	db.addData(dbName, data)
}

app.listDatabases = () => {
	return files.filter((file) => path.extname(file) === '.db')
}

app.post('/auth', (req, res) => {
	const payload = req.body

	if (
		!payload.database?.length > 0
		|| !payload.encryptionKey?.length > 0
	) res.status(500)
		.json({
			'status': false
		})

	app.authoriser = new auth(
		payload.database,
		payload.encryptionKey
	)

	res.type('application/json')
		.status(200)
		.json({
			'status': true,
			'x-auth': app.authoriser.header,
		})
})

app.get('/list', (req, res) => {
	res.send({
		databases: app.listDatabases()
	})
})

/**
 * Get the DB as json
 */
app.get('/db', (req, res) => {
	const q = typeof req.query.q == 'object'
		? req.query.q
		: {}

	const options = {
		filter: {
			operator: 'and',
			conditions: Object.entries(q).map(([key, value]) => {
				let operator = '=='
				if (value.includes('*', 0)) {
					value = value.replace('*', '');
					operator = 'like'
				}
				if (!isNaN(value)) value = Number(value)

				return {
					column: key,
					operator: operator,
					value: value
				}                          
			})
		}
	}

	app.authorise(req)
		.then((json) => {
			app.getData(json.database, json.encryptionKey, options)
				.then((json) => {
					res
						.type('application/json')
						.status(200)
						.json({
							status: true,
							data: json,
						})
				})
				.catch(error => {
					res
						.status(500)
						.json({
							status: false,
							error: error.toString(),
						})
				})
		})
		.catch((error) => {
			res
				.status(403)
				.json({
					status: false,
					error: error.toString(),
				})
		})
})

app.post('/db', (req, res) => {
	const payload = req.body
	app.authorise(req)
		.then((json) => {
			app.addData(json.database, json.encryptionKey, payload.data)
				.then((json) => {
					res.status(200).json({
						status: true,
						data: json,
					})
				})
				.catch(error => {
					res.status(500).json({
						status: false,
						error: error.toString(),
					})
				})
		})
		.catch((error) => {
			res
				.status(403)
				.json({
					status: false,
					error: error.toString(),
				})
		})
})

app.listen(3070, () => {
	console.log('Server listening on port 3070')
})