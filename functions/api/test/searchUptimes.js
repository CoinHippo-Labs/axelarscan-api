require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  searchUptimes,
} = require('../methods');

module.exports = () => {
  describe(
    'searchUptimes',
    () => {
      it(
        'Should receive list of uptime',
        async () => {
          const response = await searchUptimes();

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