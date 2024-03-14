const _ = require('lodash');

const { transfersTotalVolume } = require('./token-transfer');
const { GMPTotalVolume } = require('./gmp');
const { toArray } = require('../../utils/parser');
const { isNumber } = require('../../utils/number');

module.exports = async params => _.sum(toArray(await Promise.all(
  ['transfers', 'gmp'].map(d => new Promise(async resolve => {
    let value;
    switch (d) {
      case 'transfers':
        value = await transfersTotalVolume(params);
        break;
      case 'gmp':
        value = await GMPTotalVolume(params);
        break;
      default:
        value = 0;
        break;
    }
    resolve(value);
  }))
)).filter(d => isNumber(d)));