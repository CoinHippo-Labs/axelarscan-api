const _ = require('lodash');

const { transfersTotalFee } = require('./token-transfer');
const { GMPTotalFee } = require('./gmp');
const { toArray } = require('../../utils/parser');
const { isNumber } = require('../../utils/number');

module.exports = async params => _.sum(toArray(await Promise.all(
  ['transfers', 'gmp'].map(d => new Promise(async resolve => {
    let value;
    switch (d) {
      case 'transfers':
        value = await transfersTotalFee(params);
        break;
      case 'gmp':
        value = await GMPTotalFee(params);
        break;
      default:
        value = 0;
        break;
    }
    resolve(value);
  }))
)).filter(d => isNumber(d)));