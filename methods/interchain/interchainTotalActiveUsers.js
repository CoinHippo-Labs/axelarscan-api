const _ = require('lodash');

const { transfersTotalActiveUsers } = require('./token-transfer');
const { GMPTotalActiveUsers } = require('./gmp');
const { toArray } = require('../../utils/parser');

module.exports = async params => _.sum(toArray(await Promise.all(
  ['transfer', 'gmp'].map(d => new Promise(async resolve => {
    let value;
    switch (d) {
      case 'transfer':
        value = await transfersTotalActiveUsers(params);
        break;
      case 'gmp':
        value = await GMPTotalActiveUsers(params);
        break;
      default:
        value = 0;
        break;
    }
    resolve(value);
  }))
)));