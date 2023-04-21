require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  getTVL,
} = require('../methods');

module.exports = () => {
  describe(
    'getTVL',
    () => {
      it(
        'Should receive tvl data',
        async () => {
          const response = await getTVL({ asset: 'uaxl' });

          const {
            data,
          } = { ...response };

          expect(data).to.be.an('array');
        },
      )
      .timeout(30000);
    },
  );
};