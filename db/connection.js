const monk = require('monk');
const connectionString = 'mongodb+srv://streamlabs:CmntkUUxf6ZZmN5O@edatlascluster.nrfcc.mongodb.net/streamlabs?retryWrites=true&w=majority';
const db = monk(connectionString);

module.exports = db;