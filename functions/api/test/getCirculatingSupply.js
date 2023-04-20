require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  getCirculatingSupply,
} = require('../methods');

module.exports = () => {
  describe(
    'getCirculatingSupply',
    () => {
      it(
        'Should receive circulating supply',
        async () => {
          const response = await getCirculatingSupply();

          expect(response).to.be.a('number');
        },
      )
      .timeout(10000);
    },
  );
};