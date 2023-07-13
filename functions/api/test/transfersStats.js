require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { transfersStats } = require('../methods');

module.exports = () => {
  describe(
    'transfersStats',
    () => {
      it(
        'Should receive transfers statistics data',
        async () => {
          const response = await transfersStats();
          const { data } = { ...response };
          expect(data).to.be.an('array');
        },
      )
      .timeout(10000);
    },
  );
};