require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  searchBatches,
} = require('../methods');

module.exports = () => {
  describe(
    'searchBatches',
    () => {
      it(
        'Should receive list of batch',
        async () => {
          const response = await searchBatches();

          const {
            data,
          } = { ...response };

          expect(data).to.be.an('array');
        },
      )
      .timeout(10000);
    },
  );
};