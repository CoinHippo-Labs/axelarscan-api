const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  write,
} = require('../../index');
const {
  sleep,
} = require('../../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  num_blocks_per_heartbeat,
  fraction_heartbeat_block,
} = { ...config?.[environment] };

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx_responses,
  } = { ...lcd_response };

  try {
    const records = tx_responses
      .map(t => {
        const {
          txhash,
          code,
          timestamp,
          tx,
        } = { ...t };
        let {
          height,
        } = { ...t };
        const {
          signatures,
        } = { ...tx };
        const {
          messages,
        } = { ...tx?.body };

        if (
          !code &&
          [
            'HeartBeatRequest',
          ].findIndex(s =>
            (messages || [])
              .findIndex(m =>
                m?.inner_message?.['@type']?.includes(s)
              ) > -1
          ) > -1
        ) {
          height = Number(height);

          return {
            txhash,
            height,
            period_height:
              height -
              (
                (height % num_blocks_per_heartbeat) ||
                num_blocks_per_heartbeat
              ) +
              fraction_heartbeat_block,
            timestamp:
              moment(timestamp)
                .utc()
                .valueOf(),
            signatures,
            sender:
              _.head(
                messages
                  .map(m =>
                    m?.sender
                  )
              ),
            key_ids:
              _.uniq(
                messages
                  .flatMap(m =>
                    m?.inner_message?.key_ids ||
                    []
                  )
              ),
          };
        }

        return null;
      })
      .filter(t => t?.sender);

    if (records.length > 0) {
      for (const record of records) {
        const {
          sender,
          period_height,
        } = { ...record };

        write(
          'heartbeats',
          `${sender}_${period_height}`,
          record,
        );
      }

      await sleep(1 * 1000);
    }
  } catch (error) {}
};