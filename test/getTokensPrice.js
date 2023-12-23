require('dotenv').config();

const chai = require('chai');
const { expect } = { ...chai };

const { getTokensPrice } = require('../methods');

module.exports = () => {
  describe('getTokensPrice', () => {
    it('Should receive price of tokens', async () => {
      const symbols = ['ETH', 'MATIC'];
      const response = await getTokensPrice({ symbols });
      expect(Object.keys(response)).to.have.lengthOf(symbols.length);
      Object.values(response).forEach(d => {
        expect(d).to.be.an('object');
        expect(d.price).to.be.a('number');
      });
    }).timeout(10000);
  });
};