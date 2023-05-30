require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { searchTransfers } = require('../methods');

module.exports = () => {
  describe(
    'searchTransfers',
    () => {
      it(
        'Should receive list of transfer',
        async () => {
          const response = await searchTransfers();
          const { data } = { ...response };
          expect(data).to.be.an('array');
        },
      )
      .timeout(30000);
    },
  );
};