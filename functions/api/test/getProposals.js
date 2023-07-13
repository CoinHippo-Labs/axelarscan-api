require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { getProposals } = require('../methods');

module.exports = () => {
  describe(
    'getProposals',
    () => {
      it(
        'Should receive list of proposal',
        async () => {
          const response = await getProposals();
          const { data } = { ...response };
          expect(data).to.be.an('array');
        },
      )
      .timeout(30000);
    },
  );
};