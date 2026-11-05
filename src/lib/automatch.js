// 未對應頻道自動對應：把交易紀錄上的頻道名稱依「共同名稱片段」分組，
// 同一組視為同一位直播主（跨平台），自動補別名或新增直播主。純函式，方便測試。
import { matchStreamer, norm } from './budget.js';

// 常見但不能代表個人的字，不拿來比對（避免把不相關的頻道併在一起）
const STOP = new Set([
  'ch', 'channel', 'official', 'tv', 'live', 'vtuber', 'gaming', 'game', 'games', 'music', 'jp', 'en', 'tw', 'hk', 'kr', 'cn',
  'the', 'and', 'vt', 'stream', 'streams', 'radio', 'studio', 'project', 'clip', 'clips', 'sub', 'subs',
  '頻道', '官方', '實況', '直播', '頻道台', '官方頻道', '頻道主', 'チャンネル', '公式', '層級', 'tier', '已畢業',
]);

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]/u;

/** 名稱片段：先依符號／空白切開，再依「中日韓文字 vs 其他」切開；正規化後去掉太短或常見字 */
export function segments(name) {
  const out = new Set();
  for (const part of String(name || '').normalize('NFKC').split(/[^\p{L}\p{N}ー]+/u)) {
    for (const run of part.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+/gu) || []) {
      const s = norm(run);
      if (!s || STOP.has(s) || /^\d+$/.test(s)) continue;
      if (CJK.test(s) ? s.length >= 2 : s.length >= 3) out.add(s);
    }
  }
  // 英文部分連起來也算一段：「星野晴晴 Hoshi Haru」→ hoshiharu，才對得上 Twitch 帳號 hoshiharu
  const latin = (String(name || '').normalize('NFKC').match(/[A-Za-z][A-Za-z0-9]*/g) || [])
    .map((x) => x.toLowerCase()).filter((x) => !STOP.has(x));
  if (latin.length >= 2 && latin.join('').length >= 4) out.add(latin.join(''));
  return out;
}

/**
 * 顯示名稱：從各頻道名稱裡取中日韓文字段（含中間的「·」），挑「出現在最多頻道名稱裡」的；
 * 同樣多時挑較長的（「千千波露」同時出現在「千千波露 MeowMeowPolu」和「千千波露已畢業」，勝過後者）。
 * 都沒有中日韓文字時，取去掉裝飾符號後最短的原名。
 */
export function displayName(names) {
  const list = [...names].map((n) => String(n).normalize('NFKC'));
  const cands = new Set();
  for (const n of list)
    for (const m of n.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー·・]*/gu) || []) {
      const c = m.replace(/[·・]+$/, '');
      if (c.replace(/[·・]/g, '').length >= 2) cands.add(c);
    }
  let best = '', bestCount = 0;
  for (const c of cands) {
    const count = list.filter((n) => n.includes(c)).length;
    if (count > bestCount || (count === bestCount && c.length > best.length)) { best = c; bestCount = count; }
  }
  if (best) return best;
  const clean = list.map((n) => n.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.)]+$/gu, '').trim()).filter(Boolean);
  return clean.sort((a, b) => a.length - b.length)[0] || list[0] || '';
}

/**
 * @param channels  [{ platform, channel }]（可重複），通常是所有紀錄裡的頻道
 * @param settings  目前設定
 * @returns { settings, added: [直播主名稱], extended: [直播主名稱] }；沒變動時 settings 原樣回傳
 */
export function autoMatch(channels, settings) {
  const ignore = new Set((settings.autoMatchIgnore || []).map(norm));
  // 只處理目前對不到任何直播主、有名稱、沒被使用者排除的頻道；
  // 已對應到的頻道，把它的名稱片段記到那位直播主身上（例如「星野晴晴 Hoshi Haru」讓 hoshi、haru 也算她的）
  const seen = new Map();
  const matchedSegs = new Map(); // streamerId -> Set
  for (const { platform, channel } of channels) {
    if (!channel || !platform || platform === 'manual') continue;
    const key = `${platform}|${channel}`;
    if (seen.has(key) || ignore.has(norm(channel))) continue;
    const segs = segments(channel);
    const sid = matchStreamer(settings, platform, channel);
    if (sid) {
      if (!matchedSegs.has(sid)) matchedSegs.set(sid, new Set());
      for (const x of segs) matchedSegs.get(sid).add(x);
      continue;
    }
    if (segs.size) seen.set(key, { platform, channel, segs });
  }
  const items = [...seen.values()];
  if (!items.length) return { settings, added: [], extended: [] };

  // 併查集：有共同片段就同一組
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  items.forEach((it, i) => {
    for (const s of it.segs) {
      if (owner.has(s)) parent[find(i)] = find(owner.get(s));
      else owner.set(s, i);
    }
  });
  const groups = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });

  // 既有直播主的片段，用來判斷一組是不是某位已設定的直播主在新平台的頻道
  const streamers = settings.streamers.map((s) => ({ ...s, aliases: { ...s.aliases } }));
  const streamerSegs = streamers.map((s) => {
    const all = new Set(segments(s.name));
    for (const list of Object.values(s.aliases || {})) for (const a of list) for (const x of segments(a)) all.add(x);
    for (const x of matchedSegs.get(s.id) || []) all.add(x);
    return all;
  });

  const added = [], extended = [];
  for (const group of groups.values()) {
    const segs = new Set(group.flatMap((g) => [...g.segs]));
    const hit = streamerSegs.findIndex((ss) => [...ss].some((x) => segs.has(x)));
    const target = hit >= 0
      ? streamers[hit]
      : (() => {
          const s = {
            id: `auto-${Date.now().toString(36)}-${added.length}`,
            name: displayName(group.map((g) => g.channel)),
            limit: settings.defaultStreamerLimit,
            aliases: { hivebee: [], youtube: [], twitch: [] },
            auto: true,
          };
          streamers.push(s);
          streamerSegs.push(segs);
          added.push(s.name);
          return s;
        })();
    for (const g of group) {
      const list = (target.aliases[g.platform] ||= []);
      if (!list.includes(g.channel)) list.push(g.channel);
    }
    if (hit >= 0 && !extended.includes(target.name)) extended.push(target.name);
  }
  return { settings: { ...settings, streamers }, added, extended };
}
