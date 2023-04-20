require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  getTotalSupply,
} = require('../methods');

module.exports = () => {
  describe(
    'getTotalSupply',
    () => {
      it(
        'Should receive total supply',
        async () => {
          const response = await getTotalSupply();

          expect(response).to.be.a('number');
        },
      )
      .timeout(10000);
    },
  );
};