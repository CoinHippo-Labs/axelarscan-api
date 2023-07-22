require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { transfersTotalFee } = require('../methods');

module.exports = () => {
  describe(
    'transfersTotalFee',
    () => {
      it(
        'Should receive transfers total fee',
        async () => {
          const response = await transfersTotalFee();
          expect(response).to.be.a('number');
        },
      )
      .timeout(10000);
    },
  );
};