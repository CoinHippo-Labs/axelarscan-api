require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { interchainTotalVolume } = require('../methods');

module.exports = () => {
  describe(
    'interchainTotalVolume',
    () => {
      it(
        'Should receive interchain total volume',
        async () => {
          const response = await interchainTotalVolume();
          expect(response).to.be.a('number');
        },
      )
      .timeout(10000);
    },
  );
};