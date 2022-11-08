const axios = require('axios');
const config = require('config-yml');
const {
  write,
} = require('../../index');

const environment =
  process.env.ENVIRONMENT ||
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
          (t?.tx?.body?.messages || [])
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      )
      .map(t => t.txhash);

    if (
      hashes.length > 0 &&
      endpoints?.api
    ) {
      for (let i = 0; i < hashes.length; i++) {
        const txhash = hashes[i];

        const data = {
          txhash,
          updated_at:
            moment()
              .valueOf(),
        };

        if (
          i === 0 ||
          i === _tx_responses.length - 1
        ) {
          await write(
            'txs_index_queue',
            txhash,
            data,
          );
        }
        else {
          write(
            'txs_index_queue',
            txhash,
            data,
          );
        }
      }

      const api = axios.create(
        {
          baseURL: endpoints.api,
          timeout: 5000,
        },
      );

      for (let i = 0; i < hashes.length; i++) {
        const txhash = hashes[i];

        const data = {
          module: 'lcd',
          path: `/cosmos/tx/v1beta1/txs/${txhash}`,
        };

        if (
          i === 0 ||
          i === hashes.length - 1
        ) {
          await api.post(
            '',
            data,
          ).catch(error => { return { data: { error } }; });
        }
        else {
          api.post(
            '',
            data,
          ).catch(error => { return { data: { error } }; });
        }
      }
    }
  } catch (error) {}
};