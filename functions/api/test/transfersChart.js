require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { transfersChart } = require('../methods');

module.exports = () => {
  describe(
    'transfersChart',
    () => {
      it(
        'Should receive transfers chart data',
        async () => {
          const response = await transfersChart();
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