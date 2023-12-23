const getTVL = require('./getTVL');

module.exports = async context => {
  await getTVL();
};