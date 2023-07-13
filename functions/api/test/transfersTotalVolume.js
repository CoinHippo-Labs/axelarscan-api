require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { transfersTotalVolume } = require('../methods');

module.exports = () => {
  describe(
    'transfersTotalVolume',
    () => {
      it(
        'Should receive transfers total volume',
        async () => {
          const response = await transfersTotalVolume();
          expect(response).to.be.a('number');
        },
      )
      .timeout(10000);
    },
  );
};