require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { searchBlocks } = require('../methods');

module.exports = () => {
  describe(
    'searchBlocks',
    () => {
      it(
        'Should receive list of block',
        async () => {
          const response = await searchBlocks();
          const { data } = { ...response };
          expect(data).to.be.an('array');
        },
      )
      .timeout(30000);
    },
  );
};