require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { getTokenInfo } = require('../methods');

module.exports = () => {
  describe(
    'getTokenInfo',
    () => {
      it(
        'Should receive total info',
        async () => {
          const response = await getTokenInfo();
          expect(response).to.be.a('object');
        },
      )
      .timeout(10000);
    },
  );
};