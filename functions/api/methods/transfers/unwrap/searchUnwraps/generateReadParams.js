module.exports = params => {
  const {
    aggs,
    fields,
    _source,
    from,
    size,
    sort,
  } = { ...params };

  return {
    aggs: aggs || undefined,
    fields: fields || undefined,
    _source: _source || undefined,
    from: !isNaN(from) ? Number(from) : 0,
    size: !isNaN(size) ? Number(size) : 10,
    sort: sort || [{ updated_at: 'desc' }],
    track_total_hits: true,
  };
};