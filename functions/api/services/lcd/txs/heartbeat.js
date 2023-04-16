const _ = require('lodash');
const moment = require('moment');

const {
  write,
} = require('../../index');

const num_blocks_per_heartbeat = 50;

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
              ) + 1,
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

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      const {
        sender,
        period_height,
      } = { ...record };

      const id = `${sender}_${period_height}`;

      if (
        i === 0 ||
        i === records.length - 1
      ) {
        await write(
          'heartbeats',
          id,
          record,
        );
      }
      else {
        write(
          'heartbeats',
          id,
          record,
        );
      }
    }
  } catch (error) {}
};