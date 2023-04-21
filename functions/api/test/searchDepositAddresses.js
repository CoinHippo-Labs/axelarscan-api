require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  searchDepositAddresses,
} = require('../methods');

module.exports = () => {
  describe(
    'searchDepositAddresses',
    () => {
      it(
        'Should receive list of deposit address',
        async () => {
          const response = await searchDepositAddresses();

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