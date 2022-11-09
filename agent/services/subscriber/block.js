const WebSocket = require('ws');
const axios = require('axios');
const config = require('config-yml');
const {
  log,
  sleep,
} = require('../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const service_name = 'block-subscriber';

const {
  endpoints,
  num_prev_blocks_fetch_tx,
} = { ...config?.[environment] };

module.exports = () => {
  if (
    endpoints?.ws &&
    endpoints.api
  ) {
    // initial api
    const api =
      axios.create(
        {
          baseURL: endpoints.api,
          timeout: 10000,
        },
      );

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

          ws.send(`{"jsonrpc":"2.0","method":"subscribe","id":"0","params":{"query":"tm.event='NewBlock'"}}`);
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
            data =
              JSON.parse(
                data.toString()
              );

            const {
              height,
            } = { ...data?.result?.data?.value?.block?.header };

            if (height) {
              log(
                'info',
                service_name,
                'get block',
                { height },
              );

              for (let i = 0; i <= num_prev_blocks_fetch_tx; i++) {
                const _height = height - i;

                if (_height > 0) {
                  await api
                    .get(
                      '',
                      {
                        params: {
                          module: 'lcd',
                          path:
                            i === 0 ?
                              `/cosmos/base/tendermint/v1beta1/blocks/${_height}` :
                              '/cosmos/tx/v1beta1/txs',
                          events:
                            i === 0 ?
                              undefined :
                              `tx.height=${_height}`,
                        },
                      },
                    )
                    .catch(error => {
                      return {
                        data: {
                          error,
                        },
                      };
                    });
                }
              }
            }
          } catch (error) {}
        },
      );
    }

    // start subscribe
    subscribe();
  }
};