require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { transfersTopUsers } = require('../methods');

module.exports = () => {
  describe(
    'transfersTopUsers',
    () => {
      it(
        'Should receive transfers top users data',
        async () => {
          const response = await transfersTopUsers();
          const { data } = { ...response };
          data.forEach(d => {
            const { num_txs } = { ...d };
            expect(num_txs).to.be.a('number');
          });
        },
      )
      .timeout(10000);
    },
  );
};