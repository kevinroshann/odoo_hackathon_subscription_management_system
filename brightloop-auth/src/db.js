const { openDatabase, initializeDefaults } = require('./database');

// Singleton connection used by every router and service.
const db = openDatabase();
initializeDefaults(db);

module.exports = db;
