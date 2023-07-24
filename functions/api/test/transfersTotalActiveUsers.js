require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { transfersTotalActiveUsers } = require('../methods');

module.exports = () => {
  describe(
    'transfersTotalActiveUsers',
    () => {
      it(
        'Should receive transfers total active users',
        async () => {
          const response = await transfersTotalActiveUsers();
          expect(response).to.be.a('number');
        },
      )
      .timeout(10000);
    },
  );
};