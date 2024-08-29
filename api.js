const auth = require('./auth')
const bodyParser = require("body-parser")

class api {

	constructor(app, db) {
		this.app = app
		this.db = db

		app.use(bodyParser.json())

		app.get('/list', (req, res) => this.getList(req, res))
		app.get('/db/:dbName', (req, res) => this.getDatabase(req, res))
		app.get('/db/:dbName/:id', (req, res) => this.getItem(req, res))

		app.put('/db/:dbName/:id', (req, res) => this.updateItem(req, res))

		app.delete('/db/:dbName/:id', (req, res) => this.deleteItem(req, res))

		app.post('/auth', (req, res) => this.getAuth(req, res))
		app.post('/db/:dbName', (req, res) => this.addItem(req, res))
	}

	async addItem(req, res) {
		const payload = req.body
		this.authorise(req)
			.then((json) => {
				const dbName = req.params.dbName
				if (!Object.values(json.databases).includes(dbName)) {
					throw new Error('Unauthorised')
				}
				this.db.addData(dbName, payload)
					.then((json) => {
						res.status(200).json(json)
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
	}

	async authorise(req) {
		const xAuth = req.header('x-auth')
		let authorised = false
		if (typeof this.app.authoriserValues !== 'undefined') {
			if (xAuth === this.app.authoriserValues.header) authorised = true
		}
		if (!authorised) throw new Error('Forbidden')

		return {
			databases: this.app.authoriserValues.databases,
			encryptionKey: this.app.authoriserValues.encryptionKey
		}
	}

	buildRequestOptions(req) {
		return {
			filter: {
				operator: 'and',
				conditions: Object.entries(req.query).map(([key, value]) => {
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
	}

	async deleteItem(req, res) {
		const options = this.buildRequestOptions({
			query: {
				'id': req.params.id,
			}
		})

		this.authorise(req)
			.then((json) => {
				const dbName = req.params.dbName
				if (!Object.values(json.databases).includes(dbName)) {
					throw new Error('Unauthorised')
				}

				this.db.deleteData(dbName, options)
					.then((json) => {
						res
							.type('application/json')
							.status(200)
							.json(json)
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
	}

	async getAuth(req, res) {
		const payload = req.body

		// if we don't have the required data then return false
		if (!payload.secretKey?.length > 0)
			res.status(500)
				.json({'status': false})

		new auth(
			this.db,
			payload.secretKey
		)
			.authorise()
			.then(values => {
				this.app.authoriserValues = values
				res.type('application/json')
					.status(200)
					.json({
						'status': true,
						'x-auth': values.header,
					})
			})
	}

	async getDatabase(req, res) {
		const options = this.buildRequestOptions(req)
		this.authorise(req)
			.then((json) => {
				const dbName = req.params.dbName
				if (!Object.values(json.databases).includes(dbName)) {
					throw new Error('Unauthorised')
				}

				this.db.queryData(dbName, options)
					.then((json) => {
						res
							.type('application/json')
							.status(200)
							.json(json)
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
	}

	async getItem(req, res) {
		const options = this.buildRequestOptions({
			query: {
				'id': req.params.id,
			}
		})

		this.authorise(req)
			.then((json) => {
				const dbName = req.params.dbName
				if (!Object.values(json.databases).includes(dbName)) {
					throw new Error('Unauthorised')
				}

				this.db.queryData(dbName, options)
					.then((json) => {
						res
							.type('application/json')
							.status(200)
							.json(json.pop())
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
	}

	async getList(req, res) {
		this.authorise(req)
			.then(json => {
				res.send({
					databases: json.databases
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
	}

	async updateItem(req, res) {
		this.authorise(req)
			.then((json) => {
				const dbName = req.params.dbName
				if (!Object.values(json.databases).includes(dbName)) {
					throw new Error('Unauthorised')
				}

				this.db.updateData(
					dbName,
					{
						'id': req.params.id,
					},
					req.body
				)
					.then((json) => {
						res
							.type('application/json')
							.status(200)
							.json(json)
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
	}

}

module.exports = api;