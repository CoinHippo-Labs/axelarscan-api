require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  searchTransactions,
} = require('../methods');

module.exports = () => {
  describe(
    'searchTransactions',
    () => {
      it(
        'Should receive list of transaction',
        async () => {
          const response = await searchTransactions();

          const {
            data,
          } = { ...response };

          expect(data).to.be.an('array');
        },
      )
      .timeout(30000);
    },
  );
};