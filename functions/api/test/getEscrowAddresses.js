require('dotenv').config();

const chai = require('chai');
const {
  expect,
} = { ...chai };

const {
  getEscrowAddresses,
} = require('../methods');

module.exports = () => {
  describe(
    'getEscrowAddresses',
    () => {
      it(
        'Should receive list of escrow address',
        async () => {
          const response = await getEscrowAddresses({ asset: 'uaxl', chain: 'polygon' });

          const {
            data,
          } = { ...response };

          expect(data).to.be.an('array');
        },
      )
      .timeout(10000);
    },
  );
};