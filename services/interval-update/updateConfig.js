const METHODS = require('../../methods');
const { getAxelarConfig } = require('../../utils/config');

module.exports = async () => {
  await Promise.all(['getAxelarConfig'].map(d => new Promise(async resolve => {
    switch (d) {
      case 'getAxelarConfig':
        resolve(await getAxelarConfig(undefined, true));
        break;
      default:
        resolve(await METHODS[d]());
        break;
    }
  })));
};