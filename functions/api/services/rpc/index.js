const axios = require('axios');
const moment = require('moment');
const config = require('config-yml');
const index_end_block_events = require('./end_block_events');
const {
  to_json,
  decode_base64,
} = require('../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  endpoints,
  num_blocks_avg_block_time,
} = { ...config?.[environment] };

module.exports = async (
  path = '',
  params = {},
) => {
  let response;

  if (endpoints?.rpc) {
    const rpc = axios.create(
      {
        baseURL: endpoints.rpc,
        timeout: 3000,
      },
    );

    const _response = await rpc.get(
      path,
      { params },
    ).catch(error => { return { data: { result: null, error } }; });

    let {
      data,
    } = { ..._response };
    const {
      result,
    } = { ...data };

    /* start custom response */
    if (result) {
      if (path === '/status') {
        const {
          sync_info,
        } = { ...result };

        data = sync_info;

        const {
          latest_block_time,
        } = { ...data };
        let {
          latest_block_height,
        } = { ...data };

        if (
          latest_block_height &&
          endpoints.lcd
        ) {
          latest_block_height = Number(latest_block_height);

          const lcd = axios.create(
            {
              baseURL: endpoints.lcd,
              timeout: 3000,
            },
          );

          const _response = await lcd.get(
            `/cosmos/base/tendermint/v1beta1/blocks/${latest_block_height - num_blocks_avg_block_time}`,
          ).catch(error => { return { data: { error } }; });

          const {
            time,
          } = { ..._response?.data?.block?.header };

          if (
            time &&
            num_blocks_avg_block_time
          ) {
            data.avg_block_time =
              moment(latest_block_time)
                .diff(
                  moment(time),
                  'seconds',
                ) /
                num_blocks_avg_block_time;
          }
        }
      }
      else if (path === '/dump_consensus_state') {
        const {
          round_state,
        } = { ...result };

        data = round_state;
      }
      else if (path === '/block_results') {
        let {
          height,
          txs_results,
          begin_block_events,
          end_block_events,
        } = { ...result };

        height = Number(height);

        txs_results = (txs_results || [])
          .map(t => {
            let {
              log,
              events,
            } = { ...t };

            log =
              to_json(log) ||
              log;

            events = (events || [])
              .map(e => {
                let {
                  attributes,
                } = { ...e };

                attributes = (attributes || [])
                  .map(a => {
                    let {
                      key,
                      value,
                    } = { ...a };

                    key = decode_base64(key);
                    value = decode_base64(value);

                    return {
                      ...a,
                      key,
                      value,
                    };
                  });

                return {
                  ...e,
                  attributes,
                };
              });

            return {
              ...t,
              log,
              events,
            };
          });

        begin_block_events = (begin_block_events || [])
          .map(e => {
            let {
              attributes,
            } = { ...e };

            attributes = (attributes || [])
              .map(a => {
                let {
                  key,
                  value,
                } = { ...a };

                key = decode_base64(key);
                value = decode_base64(value);

                return {
                  ...a,
                  key,
                  value,
                };
              });

            return {
              ...e,
              attributes,
            };
          });

        end_block_events = (end_block_events || [])
          .map(e => {
            let {
              attributes,
            } = { ...e };

            attributes = (attributes || [])
              .map(a => {
                let {
                  key,
                  value,
                } = { ...a };

                key = decode_base64(key);
                value = decode_base64(value);

                return {
                  ...a,
                  key,
                  value,
                };
              });

            return {
              ...e,
              attributes,
            };
          });

        end_block_events =
          await index_end_block_events(
            end_block_events,
          );

        data = {
          ...result,
          height,
          txs_results,
          begin_block_events,
          end_block_events,
        };
      }
    }
    /* end custom response */

    response = data;
  }

  return response;
};