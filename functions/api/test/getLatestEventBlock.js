require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { getLatestEventBlock } = require('../methods');

module.exports = () => {
  describe(
    'getLatestEventBlock',
    () => {
      it(
        'Should receive latest block of each events',
        async () => {
          const response = await getLatestEventBlock('avalanche');
          const { latest } = { ...response };
          Object.values({ ...latest }).forEach(v => {
            expect(v).to.be.a('number');
          });
        },
      )
      .timeout(10000);
    },
  );
};