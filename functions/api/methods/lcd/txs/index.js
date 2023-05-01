const indexTransaction = require('../tx');

module.exports = async (
  lcd_response = {},
  params = {},
) => {
  const {
    txs,
    tx_responses,
  } = { ...lcd_response };

  if (txs && tx_responses) {
    await Promise.all(tx_responses.map((t, i) => new Promise(async resolve => resolve(await indexTransaction({ tx: txs[i], tx_response: t }, params)))));
  }

  return lcd_response;
};