require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { searchHeartbeats } = require('../methods');

module.exports = () => {
  describe(
    'searchHeartbeats',
    () => {
      it(
        'Should receive list of heartbeat',
        async () => {
          const response = await searchHeartbeats();
          const { data } = { ...response };
          expect(data).to.be.an('array');
        },
      )
      .timeout(30000);
    },
  );
};