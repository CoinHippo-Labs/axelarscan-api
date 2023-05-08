const _ = require('lodash');
const moment = require('moment');

const lcd = require('../../lcd');
const {
  toArray,
} = require('../../../utils');

module.exports = async params => {
  const {
    id,
  } = { ...params };

  let data;
  let page_key = true;

  while (page_key) {
    const response = await lcd(`/cosmos/gov/v1beta1/proposals/${id}/votes`, { 'pagination.key': page_key && typeof page_key === 'string' ? page_key : undefined });
  
    const {
      votes,
      pagination,
    } = { ...response };

    data =
      _.uniqBy(
        _.concat(
          toArray(data),
          toArray(votes)
            .map(d => {
              const {
                proposal_id,
                option,
                options,
              } = { ...d };

              d.proposal_id = Number(proposal_id);
              d.option = option?.replace('VOTE_OPTION_', '');
              d.options =
                toArray(options)
                  .map(_d => {
                    const {
                      option,
                      weight,
                    } = { ..._d };

                    return {
                      ..._d,
                      option: option?.replace('VOTE_OPTION_', ''),
                      weight: Number(weight),
                    };
                  });

              return d;
            })
        ),
        'voter',
      );

    page_key = pagination?.page_key;
  }

  return {
    data: toArray(data),
    total: toArray(data).length,
  };
};