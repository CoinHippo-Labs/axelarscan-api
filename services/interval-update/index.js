const updateTVL = require('./updateTVL');
const updateStats = require('./updateStats');

module.exports = async context => {
  await Promise.all(['tvl', 'stats'].map(d => new Promise(async resolve => {
    switch (d) {
      case 'tvl':
        resolve(await updateTVL());
        break;
      case 'stats':
        resolve(await updateStats());
        break;
      default:
        resolve();
        break;
    }
  })));
};