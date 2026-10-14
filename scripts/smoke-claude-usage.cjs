/* Offline service tests: temporary dummy credentials and mocked HTTPS only. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const assert = require('node:assert/strict');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src', 'claude-usage-test.cjs');
const compiled = new Module(filename);
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(ts.transpileModule(fs.readFileSync(path.join(root, 'src', 'claude-usage-service.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { readClaudeCredentials, parseClaudeUsage, requestClaudeUsage, createClaudeUsageService } = compiled.exports;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bachnv6-claude-usage-'));
const originalGet = https.get;
let calls = 0;
let reply;
let now = Date.now();
const tokenA = 'dummy-token-A-never-exposed';
const tokenB = 'dummy-token-B-never-exposed';
const payload = () => ({
  five_hour: { utilization: 23.5, resets_at: new Date(now + 3 * 3600000).toISOString() },
  seven_day: { utilization: 67, resets_at: new Date(now + 3 * 86400000).toISOString() },
});
https.get = (url, options, callback) => {
  assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(options.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert([`Bearer ${tokenA}`, `Bearer ${tokenB}`].includes(options.headers.Authorization));
  assert(options.signal instanceof AbortSignal);
  calls++;
  const current = reply;
  const request = new EventEmitter();
  request.destroy = () => queueMicrotask(() => request.emit('error', new Error('Request destroyed')));
  queueMicrotask(() => {
    if (current.networkError) { request.emit('error', new Error(tokenA)); return; }
    const response = new PassThrough();
    response.statusCode = current.status ?? 200;
    response.headers = current.headers ?? {};
    callback(response);
    response.end(current.body ?? JSON.stringify(payload()));
  });
  return request;
};

(async () => {
  try {
    const directory = path.join(temporary, '.claude');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: tokenA, subscriptionType: 'max' } }));
    assert.deepEqual(await readClaudeCredentials({}, temporary), { accessToken: tokenA, planType: 'max' });
    assert.equal((await readClaudeCredentials({ CLAUDE_CONFIG_DIR: directory }, '/unused')).accessToken, tokenA);
    assert.equal((await readClaudeCredentials({ CLAUDE_CODE_OAUTH_TOKEN: tokenB }, '/unused')).accessToken, tokenB);
    await assert.rejects(readClaudeCredentials({}, path.join(temporary, 'missing')), /claude auth login/);
    fs.writeFileSync(path.join(directory, '.credentials.json'), '{broken');
    await assert.rejects(readClaudeCredentials({}, temporary), /claude auth login/);
    fs.writeFileSync(path.join(directory, '.credentials.json'), 'x'.repeat(300000));
    await assert.rejects(readClaudeCredentials({}, temporary), /claude auth login/);
    assert.equal(calls, 0);
    console.log('PASS Windows/Linux credential paths, custom config directory, OAuth environment override, missing/corrupt/oversized credentials');

    assert.deepEqual(parseClaudeUsage(payload()).map(item => item.usedPercent), [23.5, 67]);
    assert.equal(parseClaudeUsage({ five_hour: { utilization: 0, resets_at: null } })[0].usedPercent, 0);
    assert.equal(parseClaudeUsage({ seven_day: { utilization: 0.5, resets_at: 'invalid' } })[0].usedPercent, 0.5);
    assert.equal(parseClaudeUsage({ five_hour: { utilization: 150 } })[0].usedPercent, 100);
    assert.equal(parseClaudeUsage({ five_hour: null, seven_day: payload().seven_day }).length, 1);
    assert.throws(() => parseClaudeUsage({ five_hour: { utilization: '23' } }), /did not report/);
    assert.throws(() => parseClaudeUsage(null), /invalid/);
    console.log('PASS exact percentage units, zero/fractional usage, missing windows, reset dates and response validation');

    let account = { accessToken: tokenA, planType: 'max' };
    const service = createClaudeUsageService({ credentials: async () => { if (!account) throw new Error(tokenA); return account; }, now: () => now });
    reply = {};
    const results = await Promise.all([service.get(), service.get(), service.get()]);
    assert.equal(calls, 1);
    for (const result of results) {
      assert.equal(result.status, 'live');
      assert.equal(result.provider, 'claude');
      assert.deepEqual(result.windows.map(item => item.usedPercent), [23.5, 67]);
      assert.equal(result.creditBalance, null);
      assert.equal(result.resetBank, null);
      assert(!JSON.stringify(result).includes(tokenA));
    }
    results[0].windows[0].usedPercent = 99;
    assert.equal((await service.get()).windows[0].usedPercent, 23.5);
    await service.get(true);
    assert.equal(calls, 1);
    now += 61000;
    await service.get(true);
    assert.equal(calls, 2);
    console.log('PASS request deduplication, five-minute caching, manual refresh throttling, snapshot isolation and secret redaction');

    now += 61000;
    reply = { status: 429, headers: { 'retry-after': '120' } };
    const limited = await service.get(true);
    assert.equal(limited.status, 'stale');
    assert(limited.error.includes('rate limited'));
    const limitedCalls = calls;
    now += 61000;
    await service.get(true);
    assert.equal(calls, limitedCalls);
    now += 61000;
    reply = {};
    assert.equal((await service.get(true)).status, 'live');
    assert.equal(calls, limitedCalls + 1);
    console.log('PASS HTTP 429 Retry-After cooldown, stale-data fallback and recovery');

    now += 61000;
    reply = { status: 401, body: tokenA };
    const denied = await service.get(true);
    assert.equal(denied.status, 'unavailable');
    assert.equal(denied.windows.length, 0);
    assert(denied.error.includes('claude auth login'));
    assert(!JSON.stringify(denied).includes(tokenA));
    account = { accessToken: tokenB, planType: 'pro' };
    reply = {};
    assert.equal((await service.get()).planType, 'pro');
    account = { accessToken: tokenA, planType: 'max' };
    reply = { status: 503 };
    assert.equal((await service.get()).windows.length, 0);
    account = null;
    assert.equal((await service.get()).windows.length, 0);
    console.log('PASS authentication failures, account changes and logout clear prior account values');

    for (const scenario of [{ status: 302 }, { status: 403 }, { body: '{invalid' }, { body: 'x'.repeat(140000) }, { networkError: true }]) {
      reply = scenario;
      await assert.rejects(requestClaudeUsage(tokenA), error => !error.message.includes(tokenA));
    }
    console.log('PASS redirects are not followed; transport, permission and oversized/invalid response errors never expose credentials');
  } finally {
    https.get = originalGet;
    assert(path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('bachnv6-claude-usage-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
