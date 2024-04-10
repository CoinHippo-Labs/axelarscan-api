const updateTVL = require('./updateTVL');
const updateStats = require('./updateStats');
const updateConfig = require('./updateConfig');

module.exports = async context => {
  await Promise.all(['tvl', 'stats', 'config'].map(d => new Promise(async resolve => {
    switch (d) {
      case 'tvl':
        resolve(await updateTVL());
        break;
      case 'stats':
        resolve(await updateStats());
        break;
      case 'config':
        resolve(await updateConfig());
        break;
      default:
        resolve();
        break;
    }
  })));
};