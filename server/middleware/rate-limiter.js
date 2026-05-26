const { log } = require('../logger');

/**
 * Lightweight in-memory rate limiter middleware.
 * Prevents DDoS and resource abuse.
 * 
 * @param {Object} options 
 * @param {number} options.windowMs - Time window in milliseconds (default 15m)
 * @param {number} options.max - Maximum number of requests allowed per window (default 300)
 */
function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 300;
  const ipHits = new Map();

  const interval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of ipHits.entries()) {
      if (now > data.resetTime) {
        ipHits.delete(ip);
      }
    }
  }, windowMs);

  if (interval.unref) {
    interval.unref();
  }

  return function (req, res, next) {
    const ip = req.headers['cf-connecting-ip'] ||
               req.ip ||
               (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
               req.socket.remoteAddress;
    const now = Date.now();

    let clientData = ipHits.get(ip);
    if (!clientData || now > clientData.resetTime) {
      clientData = {
        count: 0,
        resetTime: now + windowMs
      };
      ipHits.set(ip, clientData);
    }

    clientData.count++;

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - clientData.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(clientData.resetTime / 1000));

    if (clientData.count > max) {
      log('WARNING', 'SERVER', `Rate limit exceeded for IP ${ip} (limit: ${max})`);
      return res.status(429).json({
        message: 'Too many requests, please try again later.'
      });
    }

    next();
  };
}

module.exports = {
  rateLimiter
};
