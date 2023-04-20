module.exports = params => {
  const {
    aggs,
    from,
    size,
    sort,
  } = { ...params };

  return {
    aggs: aggs || undefined,
    from: !isNaN(from) ? Number(from) : 0,
    size: !isNaN(size) ? Number(size) : 25,
    sort: sort || [{ 'created_at.ms': 'desc' }],
    track_total_hits: true,
  };
};