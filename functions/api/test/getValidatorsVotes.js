require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { getValidatorsVotes } = require('../methods');

module.exports = () => {
  describe(
    'getValidatorsVotes',
    () => {
      it(
        'Should receive list of validator with votes',
        async () => {
          const response = await getValidatorsVotes();
          const { data } = { ...response };
          expect(data).to.be.an('object');
        },
      )
      .timeout(30000);
    },
  );
};