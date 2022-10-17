const axios = require('axios');
const config = require('config-yml');
const {
  sleep,
} = require('../../../utils');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx_responses,
  } = { ...lcd_response };

  try {
    const hashes = tx_responses
      .filter(t =>
        !t?.code &&
        [
          'RouteIBCTransfersRequest',
          'MsgAcknowledgement',
          'MsgTimeout',
          'ExecutePendingTransfersRequest',
        ].findIndex(s =>
          t?.tx?.body?.messages?.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      )
      .map(t => t.txhash);

    if (
      hashes.length > 0 &&
      endpoints?.api
    ) {
      const api = axios.create(
        {
          baseURL: endpoints.api,
        },
      );

      for (const txhash of hashes) {
        api.post(
          '',
          {
            module: 'lcd',
            path: `/cosmos/tx/v1beta1/txs/${txhash}`,
          },
        ).catch(error => { return { data: { error } }; });
      }

      await sleep(1 * 1000);
    }
  } catch (error) {}
};