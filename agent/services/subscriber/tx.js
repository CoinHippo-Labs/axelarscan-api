const axios = require('axios');
const WebSocket = require('ws');
const config = require('config-yml');
const {
  log,
  sleep,
} = require('../../utils');

const service_name = 'tx-subscriber';
const environment = process.env.ENVIRONMENT || config?.environment;

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = () => {
  if (endpoints?.rpc && endpoints.api) {
    // initial api
    const api = axios.create({ baseURL: endpoints.api });

    // initial function to subscribe web socket
    const subscribe = () => {
      // initial web socket
      const url = `ws://${new URL(endpoints.rpc).hostname}:${new URL(endpoints.rpc).port}/websocket`;
      const ws = new WebSocket(url);

      ws.on('open', () => {
        log(
          'info',
          service_name,
          'connect',
          { url },
        );

        ws.send(`{"jsonrpc":"2.0","method":"subscribe","id":"0","params":{"query":"tm.event='Tx'"}}`);
      });

      ws.on('close', async code => {
        log(
          'info',
          service_name,
          'disconnect',
          { code },
        );

        await sleep(3 * 1000);
        subscribe();
      });

      ws.on('error', error => {
        log(
          'error',
          service_name,
          'error',
          { message: error?.message },
        );

        ws.close();
      });

      ws.on('message', async data => {
        try {
          data = JSON.parse(data.toString());

          const {
            events,
          } = { ...data?.result };

          const txHashes = events?.['tx.hash'] || [];

          for (const txhash of txHashes) {
            log(
              'info',
              service_name,
              'get tx',
              { txhash },
            );

            await api.get(
              '',
              {
                params: {
                  module: 'lcd',
                  path: `/cosmos/tx/v1beta1/txs/${txhash}`,
                },
              },
            ).catch(error => { return { data: { error } }; });
          }
        } catch (error) {}
      });
    }

    // start subscribe
    subscribe();
  }
};