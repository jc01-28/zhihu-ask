#!/usr/bin/env node
/**
 * 知乎凭证体检（doctor）
 *
 * 为什么需要它：知乎要三个凭证，缺任何一个都会在**完全不同的地方**报错，
 * 排查时极易跑偏：
 *   - App ID        —— 短数字，标识应用，进配置
 *   - OAuth App Key —— 后端换 token 用；错/缺 → 换 token 失败
 *   - Access Secret —— 开放平台调用方鉴权；错/缺 → 所有用户数据接口 401
 *
 * 这个脚本用「可控的无效请求」去反推凭证是否被服务端接受：
 *   1) 用伪造的 code 去打 /access_token。
 *      如果服务端先说「code 无效」，说明 app_id/app_key 是**被承认的**；
 *      如果它先说凭证问题，说明 app_id/app_key 有问题。
 *   2) 只用 Access Secret（不传 X-OAuth-Token）打一个用户数据接口。
 *      按官方契约，此时查的是 Access Secret 所属账号本人：
 *      Code=0 说明 Secret 有效；Code=20001 说明 Secret 无效。
 *
 * 全程不需要浏览器、不需要公网回调 —— 这是本地能做的最大程度的验证。
 *
 * 用法：node --env-file=.env.local scripts/zhihu-doctor.mjs
 */

const BASE = (process.env.ZHIHU_API_BASE || 'https://developer.zhihu.com').replace(/\/$/, '');
const APP_ID = process.env.ZHIHU_APP_ID || '';
const APP_KEY = process.env.ZHIHU_OAUTH_APP_KEY || process.env.ZHIHU_APP_KEY || '';
const SECRET = process.env.ZHIHU_ACCESS_SECRET || '';
const REDIRECT = process.env.ZHIHU_REDIRECT_URI || '';

const results = [];

function mask(value) {
  if (!value) return '(空)';
  return value.length <= 6 ? value : `${value.slice(0, 3)}…${value.slice(-3)} (len=${len(value)})`;
}
function len(value) {
  return Array.from(value).length;
}
function isLocal(uri) {
  try {
    const host = new URL(uri).hostname;
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
  } catch {
    return false;
  }
}

/** 占位符域名：看着像配好了，其实一定注册不上 */
function isPlaceholder(uri) {
  return /your-domain|example\.(com|invalid|org)|xxx|待填|placeholder/i.test(uri);
}
function record(name, status, detail) {
  results.push({ name, status, detail });
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : status === 'warn' ? '⚠️ ' : 'ℹ️ ';
  console.log(`  ${icon} ${name}`);
  if (detail) console.log(`      ${detail}`);
}

async function probeTokenExchange(appId, appKey) {
  const form = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT || 'https://example.invalid/api/oauth/callback',
    code: 'doctor-probe-invalid-code',
  });

  const res = await fetch('https://openapi.zhihu.com/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const text = await res.text();

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* 非 JSON，保留原文 */
  }

  const message = String(
    payload?.data ?? payload?.message ?? payload?.Message ?? text,
  ).slice(0, 200);

  return { status: res.status, message, hasToken: Boolean(payload?.access_token) };
}

/**
 * 差分诊断 App ID / App Key。
 *
 * 结论先行：**本地无法验证这两个凭证**，这里只做「能不能确认」的判断，不做猜测。
 *   实测依据：
 *     · POST /access_token 用伪造 code 时，真实 App ID 与错误 App ID 返回**完全相同**的
 *       "Access denied: not exists" —— 说明服务端在校验凭证之前就按「code 不存在」返回了。
 *     · GET /authorize 只是 302 跳到登录页并原样回显 app_id，同样不校验。
 *   所以本函数只在两边报错**不同**时才敢下结论；相同就如实报「无法判定」。
 */
async function checkTokenExchange() {
  const real = await probeTokenExchange(APP_ID, APP_KEY);
  if (real.hasToken) {
    record('App ID / App Key 校验', 'pass', '服务端直接返回了 token（意外，但凭证有效）');
    return true;
  }

  const control = await probeTokenExchange('0', 'doctor-probe-invalid-key');

  if (control.message !== real.message) {
    record(
      'App ID / App Key 校验',
      'pass',
      `与「故意用错的 App ID」报错不同 ⇒ 服务端对我们的凭证做了区别对待，视为已承认。` +
        `我们：${real.message} ｜ 对照：${control.message}`,
    );
    return true;
  }

  record(
    'App ID / App Key 校验',
    'info',
    `无法在本地判定（真实与错误 App ID 的报错一致："${real.message}"）—— ` +
      `服务端在校验凭证之前就返回了。**只有浏览器里的真实授权能验证这两个凭证。**`,
  );
  return false;
}

async function checkAccessSecret() {
  // 不传 X-OAuth-Token ⇒ 查 Access Secret 所属账号本人
  const url = `${BASE}/api/v1/user/contents?ContentType=all&Limit=1&Offset=0`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* ignore */
  }

  const code = payload?.Code ?? payload?.code;

  if (code === 0) {
    const items = payload?.Data?.Items ?? payload?.data?.Items ?? [];
    record(
      'Access Secret 校验',
      'pass',
      `Code=0，Secret 有效。顺带读到你自己 ${items.length} 条创作（说明这个 Secret 所属账号本人可用）`,
    );
    return true;
  }

  if (code === 20001) {
    record('Access Secret 校验', 'fail', 'Code=20001 鉴权失败 ⇒ Secret 无效或已失效，请重新生成');
    return false;
  }

  if (code === 30001 || code === 30002) {
    record('Access Secret 校验', 'warn', `Code=${code} 频率/配额限制 ⇒ Secret 本身大概率有效，但额度已紧张`);
    return true;
  }

  record(
    'Access Secret 校验',
    'fail',
    `HTTP ${res.status} Code=${code ?? '?'} 原话：${String(payload?.Message ?? text).slice(0, 200)}`,
  );
  return false;
}

async function main() {
  console.log('=== 知乎凭证体检 ===\n');
  console.log('【凭证现状】');
  record('ZHIHU_APP_ID', APP_ID ? 'pass' : 'fail', mask(APP_ID));
  record('ZHIHU_OAUTH_APP_KEY / ZHIHU_APP_KEY', APP_KEY ? 'pass' : 'fail', mask(APP_KEY));
  record('ZHIHU_ACCESS_SECRET', SECRET ? 'pass' : 'fail',
    SECRET ? mask(SECRET) : '未配置 —— 在 https://developer.zhihu.com/profile 生成');
  record('ZHIHU_REDIRECT_URI',
    REDIRECT ? (isLocal(REDIRECT) || isPlaceholder(REDIRECT) ? 'warn' : 'pass') : 'fail',
    REDIRECT
      ? `${REDIRECT}${
          isLocal(REDIRECT)
            ? '  ← 本地地址，知乎无法回调'
            : isPlaceholder(REDIRECT)
              ? '  ← 还是占位符，需要换成真实域名'
              : ''
        }`
      : '未配置');

  const missingHard = !APP_ID || !APP_KEY || !SECRET;
  console.log('');

  if (APP_ID && APP_KEY) {
    console.log('【联网校验 1/2】App ID + App Key（打 /access_token，用伪造 code 反推）');
    try {
      await checkTokenExchange();
    } catch (error) {
      record('App ID / App Key 校验', 'fail', `网络或解析失败：${error.message}`);
    }
    console.log('');
  } else {
    console.log('【联网校验 1/2】跳过 —— App ID / App Key 不齐\n');
  }

  if (SECRET) {
    console.log('【联网校验 2/2】Access Secret（只用 Bearer 打用户数据接口）');
    try {
      await checkAccessSecret();
    } catch (error) {
      record('Access Secret 校验', 'fail', `网络或解析失败：${error.message}`);
    }
    console.log('');
  } else {
    console.log('【联网校验 2/2】跳过 —— Access Secret 未配置\n');
  }

  const failed = results.filter((r) => r.status === 'fail');
  const warned = results.filter((r) => r.status === 'warn');

  console.log('=== 结论 ===');
  if (failed.length === 0 && warned.length === 0) {
    console.log('  ✅ 全部通过。可以部署后走真实 OAuth 登录了。');
  } else {
    if (failed.length) {
      console.log(`  ❌ ${failed.length} 项未通过：`);
      for (const f of failed) console.log(`     · ${f.name}`);
    }
    if (warned.length) {
      console.log(`  ⚠️  ${warned.length} 项需注意：`);
      for (const w of warned) console.log(`     · ${w.name}`);
    }
  }

  console.log('\n【下一步】');
  if (missingHard) {
    console.log('  1. 补齐上面标 ❌ 的凭证后重跑本脚本。');
  }
  if (!SECRET) {
    console.log('  · Access Secret 与 OAuth App Key 是**两个不同**的凭证，别混用。');
  }
  if (!REDIRECT || isLocal(REDIRECT)) {
    console.log('  · 真实登录必须先部署到公网 HTTPS，并把回调地址登记到开放平台白名单。');
    console.log('    localhost 只能预览页面 —— 这是知乎的限制，不是配置问题。');
  }
  console.log('  · 只有浏览器里的最终授权确认能验证端到端链路，本脚本验证的是凭证本身。');

  process.exit(missingHard || failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
