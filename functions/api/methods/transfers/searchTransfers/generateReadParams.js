const { toArray } = require('../../../utils');

module.exports = params => {
  const { aggs, fields, _source, from, size, sort, txHash } = { ...params };
  return {
    aggs: aggs || undefined,
    fields: fields || undefined,
    _source: _source || undefined,
    from: !isNaN(from) ? Number(from) : 0,
    size: !isNaN(size) ? Number(size) : 25,
    sort: toArray([sort || { 'send.created_at.ms': 'desc' }, txHash && { 'confirm.created_at.ms': 'desc' }]),
    track_total_hits: true,
  };
};