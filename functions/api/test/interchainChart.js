require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { interchainChart } = require('../methods');

module.exports = () => {
  describe(
    'interchainChart',
    () => {
      it(
        'Should receive interchain chart data',
        async () => {
          const response = await interchainChart();
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