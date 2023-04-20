require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  getTokensPrice,
} = require('../methods');

module.exports = () => {
  describe(
    'getTokensPrice',
    () => {
      it(
        'Should receive price of tokens',
        async () => {
          const symbols = ['ETH', 'MATIC'];

          const prices = await getTokensPrice(symbols);

          expect(prices).to.have.lengthOf(symbols.length);

          for (const price of prices) {
            expect(price).to.be.a('number');
          }
        },
      )
      .timeout(10000);
    },
  );
};