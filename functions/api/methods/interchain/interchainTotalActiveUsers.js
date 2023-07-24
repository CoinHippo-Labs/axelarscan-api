const _ = require('lodash');

const { transfersTotalActiveUsers } = require('../transfers');
const { GMPTotalActiveUsers } = require('../gmp');
const { toArray } = require('../../utils');

module.exports = async params => _.sum(
  toArray(
    await Promise.all(
      ['transfers', 'gmp'].map(d =>
        new Promise(
          async resolve => {
            let value;
            switch (d) {
              case 'transfers':
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
          }
        )
      )
    )
  )
);