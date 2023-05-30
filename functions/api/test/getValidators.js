require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { getValidators } = require('../methods');

module.exports = () => {
  describe(
    'getValidators',
    () => {
      it(
        'Should receive list of validator',
        async () => {
          const response = await getValidators();
          const { data } = { ...response };
          expect(data).to.be.an('array');
        },
      )
      .timeout(30000);
    },
  );
};