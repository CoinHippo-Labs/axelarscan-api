module.exports = async (
  lcd_response = {},
) => {
  let response;

  const {
    tx_responses,
  } = { ...lcd_response };

  if (tx_responses) {
    await require('./heartbeat')(lcd_response);
    await require('./link')(lcd_response);
    await require('./confirm')(lcd_response);
    await require('./confirm-deposit')(lcd_response);
    await require('./vote')(lcd_response);
    await require('./ibc-axelar-transfer')(lcd_response);
  }

  response = lcd_response;

  return response;
};