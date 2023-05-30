require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { getChainMaintainers } = require('../methods');

module.exports = () => {
  describe(
    'getChainMaintainers',
    () => {
      it(
        'Should receive list of validator',
        async () => {
          const response = await getChainMaintainers({ chain: 'polygon' });
          const { maintainers } = { ...response };
          expect(maintainers).to.be.an('array');
        },
      )
      .timeout(10000);
    },
  );
};