# @syrasco/slim-db
A slimline encrypted database written in node.js, with built in API functionality


## Installation
```
npm install @syrasco/slim-db
```

## Usage

See ./example/initialiseDatabase.js as an example for setting up a _key database

See ./example/initialiseDatabase.js as an example for launching an api listener

more examples will be added soon detailing how to add databases and register a key with permissions to access the database over the api

## Features

    Create encrypted databases
	perform CRUD actions on databases and records
	query records using simple queries or complex filter conditions
	perform joins when retrieving records
	apply pagination to record retrieval
	transaction management with rollbacks

## Classes


### SlimDB:

    Performs all DB operations

### Auth:

    A simple authentication layer used by the api class

## API

    A class defining API routes for performing CRUD operations on databases


### Contributing

Pull requests are welcome!