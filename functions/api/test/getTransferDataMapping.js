require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { getTransferDataMapping } = require('../methods');

module.exports = () => {
  describe(
    'getTransferDataMapping',
    () => {
      it(
        'Should receive transfer data mapping',
        async () => {
          const response = await getTransferDataMapping();
          expect(response).to.be.an('object');
        },
      );
    },
  );
};