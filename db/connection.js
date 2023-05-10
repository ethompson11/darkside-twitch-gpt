const monk = require('monk');
const connectionString = `mongodb+srv://${process.env.DBUSER}:${process.env.DBPASS}@edatlascluster.nrfcc.mongodb.net/streamlabs?retryWrites=true&w=majority`;
const db = monk(connectionString);

module.exports = db;