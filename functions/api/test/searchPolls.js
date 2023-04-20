require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  searchPolls,
} = require('../methods');

module.exports = () => {
  describe(
    'searchPolls',
    () => {
      it(
        'Should receive list of poll',
        async () => {
          const response = await searchPolls();

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