require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  getInflation,
} = require('../methods');

module.exports = () => {
  describe(
    'getInflation',
    () => {
      it(
        'Should receive inflation',
        async () => {
          const response = await getInflation();

          const {
            inflation,
          } = { ...response };

          expect(inflation).to.be.a('number');
        },
      )
      .timeout(30000);
    },
  );
};