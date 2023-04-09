const WebSocket = require('ws');
const axios = require('axios');
const config = require('config-yml');

const {
  log,
  sleep,
} = require('../../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const service_name = 'tx-subscriber';

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = () => {
  if (endpoints?.ws && endpoints.api) {
    const api = axios.create({ baseURL: endpoints.api, timeout: 10000 });

    // initial function to subscribe web socket
    const subscribe = () => {
      // initial web socket
      const url = `${endpoints.ws}/websocket`;
      const ws = new WebSocket(url);

      ws.on(
        'open',
        () => {
          log(
            'info',
            service_name,
            'connect',
            {
              url,
            },
          );

          ws.send(`{"jsonrpc":"2.0","method":"subscribe","id":"0","params":{"query":"tm.event='Tx'"}}`);
        },
      );

      ws.on(
        'close',
        async code => {
          log(
            'info',
            service_name,
            'disconnect',
            {
              code,
            },
          );

          await sleep(3 * 1000);
          subscribe();
        },
      );

      ws.on(
        'error',
        error => {
          log(
            'error',
            service_name,
            'error',
            {
              message: error?.message,
            },
          );

          ws.close();
        },
      );

      ws.on(
        'message',
        async data => {
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
                {
                  txhash,
                },
              );

              await api.get('', { params: { module: 'lcd', path: `/cosmos/tx/v1beta1/txs/${txhash}` } }).catch(error => { return { data: { error } }; });
            }
          } catch (error) {}
        },
      );
    }

    // start subscribe
    subscribe();
  }
};