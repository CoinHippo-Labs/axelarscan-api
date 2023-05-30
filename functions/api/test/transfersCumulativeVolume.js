require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { transfersCumulativeVolume } = require('../methods');

module.exports = () => {
  describe(
    'transfersCumulativeVolume',
    () => {
      it(
        'Should receive transfers cumulative volume data',
        async () => {
          const response = await transfersCumulativeVolume();
          const { data } = { ...response };
          data.forEach(d => {
            const { cumulative_volume } = { ...d };
            expect(cumulative_volume).to.be.a('number');
          });
        },
      )
      .timeout(10000);
    },
  );
};